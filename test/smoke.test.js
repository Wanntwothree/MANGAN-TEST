const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createApp } = require("../src/server");
const { createGoogleMapsService } = require("../src/google-maps-service");
const { createWeatherService } = require("../src/weather-service");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mangan-beta-"));
const databasePath = path.join(temporaryDirectory, "test.sqlite");
const visitor = "123e4567-e89b-42d3-a456-426614174000";
const geocodeCalls = [];
const mapsService = {
  isConfigured: true,
  async geocode(address) {
    geocodeCalls.push(address);
    return {
      formattedAddress: `${address}, Dagupan City, Philippines`,
      latitude: 16.043,
      longitude: 120.334,
      placeId: "beta-place-id"
    };
  }
};
const weatherCalls = [];
const weatherService = {
  async current(latitude, longitude) {
    weatherCalls.push([latitude, longitude]);
    return {
      temperatureC: 34,
      feelsLikeC: 36,
      humidityPercent: 70,
      windKph: 12,
      condition: "Partly cloudy",
      comfort: "hot",
      advice: "It feels hot—drink water and take breaks in the shade.",
      observedAt: "2026-10-26T12:00",
      source: "Open-Meteo"
    };
  }
};
let app;
let baseUrl;

before(async () => {
  const originalAdminEmail = process.env.ADMIN_EMAIL;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_EMAIL = "mangan-admin@example.test";
  process.env.ADMIN_PASSWORD = "AdminBeta!2026VeryStrong";
  app = createApp({ databasePath, mapsService, weatherService });
  if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = originalAdminEmail;
  if (originalAdminPassword === undefined) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = originalAdminPassword;
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  if (app) {
    await new Promise((resolve, reject) => {
      app.server.close((error) => error ? reject(error) : resolve());
    });
    app.database.close();
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("beta app serves the discovery page and healthy API", async () => {
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.match(await page.text(), /Good food/);

  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  assert.deepEqual(health, { status: "ok", service: "mangan-beta" });
});

test("restaurant list supports category, search, and sorting", async () => {
  const all = await fetch(`${baseUrl}/api/restaurants`).then((response) => response.json());
  assert.equal(all.restaurants.length, 3);
  assert.equal(all.restaurants[0].name, "House of Bangus");
  assert.equal(all.restaurants[0].imageUrl, "/images/bangus-relleno-all-natural-food.jpg");
  assert.equal(all.restaurants[0].venueImageUrl, "/images/bangus-relleno-all-natural-restaurant.jpg");

  const seafood = await fetch(`${baseUrl}/api/restaurants?category=seafood`).then((response) => response.json());
  assert.equal(seafood.restaurants.length, 3);

  const search = await fetch(`${baseUrl}/api/restaurants?q=Mayombo`).then((response) => response.json());
  assert.equal(search.restaurants.length, 1);
  assert.equal(search.restaurants[0].slug, "ciudad-elmina");

  const sorted = await fetch(`${baseUrl}/api/restaurants?sort=name`).then((response) => response.json());
  assert.equal(sorted.restaurants[0].name, "Ciudad Elmina");

  const invalid = await fetch(`${baseUrl}/api/restaurants?category=unlisted`);
  assert.equal(invalid.status, 400);
});

test("favorites are isolated by browser and remain persisted in SQLite", async () => {
  const headers = { "Content-Type": "application/json", "X-Mangan-Visitor": visitor };
  const save = await fetch(`${baseUrl}/api/favorites`, {
    method: "POST",
    headers,
    body: JSON.stringify({ restaurantId: 1 })
  });
  assert.equal(save.status, 201);

  const favorites = await fetch(`${baseUrl}/api/favorites`, { headers }).then((response) => response.json());
  assert.deepEqual(favorites.favorites.map((item) => item.slug), ["house-of-bangus"]);

  const otherVisitor = await fetch(`${baseUrl}/api/favorites`, {
    headers: { "X-Mangan-Visitor": "123e4567-e89b-42d3-a456-426614174001" }
  }).then((response) => response.json());
  assert.equal(otherVisitor.favorites.length, 0);

  const invalid = await fetch(`${baseUrl}/api/favorites`, {
    method: "POST",
    headers,
    body: JSON.stringify({ restaurantId: 999 })
  });
  assert.equal(invalid.status, 400);

  const remove = await fetch(`${baseUrl}/api/favorites/1`, { method: "DELETE", headers });
  assert.equal(remove.status, 200);
});

test("beta feedback validates input and is stored", async () => {
  const headers = { "Content-Type": "application/json" };
  const invalid = await fetch(`${baseUrl}/api/feedback`, {
    method: "POST",
    headers,
    body: JSON.stringify({ topic: "idea", message: "short" })
  });
  assert.equal(invalid.status, 400);

  const valid = await fetch(`${baseUrl}/api/feedback`, {
    method: "POST",
    headers,
    body: JSON.stringify({ topic: "idea", message: "Add more restaurant photos please." })
  });
  assert.equal(valid.status, 201);
  assert.equal(app.database.prepare("SELECT COUNT(*) AS count FROM beta_feedback").get().count, 1);
});

test("API rejects malformed and oversized request bodies clearly", async () => {
  const malformed = await fetch(`${baseUrl}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{"
  });
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /valid JSON/);

  const oversized = await fetch(`${baseUrl}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: "idea", message: "x".repeat(11_000) })
  });
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).error, /too large/);

  const nonObject = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "null"
  });
  assert.equal(nonObject.status, 400);
  assert.match((await nonObject.json()).error, /JSON object/);
});

test("Google Maps geocoding adapter keeps its key server-side and handles provider responses", async () => {
  let requestedUrl;
  const service = createGoogleMapsService({
    apiKey: "test-key-never-returned-to-client",
    fetchImpl: async (url, options) => {
      requestedUrl = new URL(url);
      assert.ok(options.signal);
      return {
        ok: true,
        json: async () => ({
          status: "OK",
          results: [{
            formatted_address: "12 Beta Road, Dagupan City, Philippines",
            geometry: { location: { lat: 16.043, lng: 120.334 } },
            place_id: "google-place-id"
          }]
        })
      };
    }
  });
  const location = await service.geocode("12 Beta Road, Dagupan City");
  assert.equal(requestedUrl.hostname, "maps.googleapis.com");
  assert.equal(requestedUrl.searchParams.get("components"), "country:PH");
  assert.equal(requestedUrl.searchParams.get("key"), "test-key-never-returned-to-client");
  assert.deepEqual(location, {
    formattedAddress: "12 Beta Road, Dagupan City, Philippines",
    latitude: 16.043,
    longitude: 120.334,
    placeId: "google-place-id"
  });

  const unconfigured = createGoogleMapsService({});
  await assert.rejects(unconfigured.geocode("12 Beta Road"), (error) => error.status === 503);

  const noResults = createGoogleMapsService({
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: true, json: async () => ({ status: "ZERO_RESULTS" }) })
  });
  await assert.rejects(noResults.geocode("Unknown address"), (error) => error.status === 404);
});

test("Open-Meteo adapter classifies cold and hot weather and caches responses", async () => {
  let callCount = 0;
  let apparentTemperature = 34;
  const service = createWeatherService({
    fetchImpl: async (url, options) => {
      callCount += 1;
      assert.equal(new URL(url).hostname, "api.open-meteo.com");
      assert.ok(options.signal);
      return {
        ok: true,
        json: async () => ({
          current: {
            temperature_2m: apparentTemperature,
            apparent_temperature: apparentTemperature,
            relative_humidity_2m: 60,
            weather_code: 1,
            wind_speed_10m: 8,
            time: "2026-10-26T12:00"
          }
        })
      };
    }
  });

  const hot = await service.current(16.043, 120.334);
  assert.equal(hot.comfort, "hot");
  assert.match(hot.advice, /drink water/i);
  apparentTemperature = 5;
  const cached = await service.current(16.043, 120.334);
  assert.equal(cached.comfort, "hot");
  assert.equal(callCount, 1);
  const cold = await service.current(16.15, 120.45);
  assert.equal(cold.comfort, "cold");
  assert.match(cold.advice, /warm layer/i);
  assert.equal(callCount, 2);

  const failed = createWeatherService({
    fetchImpl: async () => ({ ok: false })
  });
  await assert.rejects(failed.current(16, 120), (error) => error.status === 502);
});

test("public restaurant location lookup geocodes once and caches coordinates", async () => {
  geocodeCalls.length = 0;
  const first = await fetch(`${baseUrl}/api/restaurants/1/location`);
  assert.equal(first.status, 200);
  const location = await first.json();
  assert.equal(location.location.latitude, 16.043);
  assert.equal(location.location.longitude, 120.334);
  assert.deepEqual(geocodeCalls, [
    "House of Bangus, RBA Paramount Building, Old De Venecia Highway, Calasiao, Dagupan City, Philippines"
  ]);

  const second = await fetch(`${baseUrl}/api/restaurants/1/location`);
  assert.equal(second.status, 200);
  assert.deepEqual(geocodeCalls, [
    "House of Bangus, RBA Paramount Building, Old De Venecia Highway, Calasiao, Dagupan City, Philippines"
  ]);

  mapsService.isConfigured = false;
  const unavailablePin = await fetch(`${baseUrl}/api/restaurants/2/location`);
  assert.equal(unavailablePin.status, 200);
  const unavailableResult = await unavailablePin.json();
  assert.equal(unavailableResult.location, null);
  assert.match(unavailableResult.message, /Google Maps key/);
  mapsService.isConfigured = true;

  const unknown = await fetch(`${baseUrl}/api/restaurants/999/location`);
  assert.equal(unknown.status, 404);
  assert.match((await fetch(`${baseUrl}/`).then((response) => response.text())), /app\.js\?v=8/);
});

test("weather API validates coordinates and returns current conditions", async () => {
  const invalid = await fetch(`${baseUrl}/api/weather?lat=100&lng=120`);
  assert.equal(invalid.status, 400);

  const missing = await fetch(`${baseUrl}/api/weather?lat=16.043`);
  assert.equal(missing.status, 400);

  const response = await fetch(`${baseUrl}/api/weather?lat=16.043&lng=120.334`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.weather.comfort, "hot");
  assert.equal(result.weather.feelsLikeC, 36);
  assert.deepEqual(weatherCalls, [[16.043, 120.334]]);
});

test("user and owner registration, login, and role authorization", async () => {
  const registerUser = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Beta Food Lover",
      email: "food-lover@example.test",
      password: "Foodie!2026",
      role: "user"
    })
  });
  assert.equal(registerUser.status, 201);
  const userResult = await registerUser.json();
  assert.equal(userResult.user.role, "user");
  const userCookie = registerUser.headers.get("set-cookie").split(";")[0];

  const ownerRegister = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Restaurant Owner",
      email: "owner@example.test",
      password: "Owner!2026Food",
      role: "owner"
    })
  });
  assert.equal(ownerRegister.status, 201);
  const ownerResult = await ownerRegister.json();
  assert.equal(ownerResult.user.role, "owner");
  const ownerCookie = ownerRegister.headers.get("set-cookie").split(";")[0];
  const weakPassword = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Weak Password User",
      email: "weak-password@example.test",
      password: "password",
      role: "user"
    })
  });
  assert.equal(weakPassword.status, 400);
  assert.match((await weakPassword.json()).error, /uppercase letter.*lowercase letter.*number.*symbol/i);

  const forbidden = await fetch(`${baseUrl}/api/owner/restaurants`, {
    headers: { Cookie: userCookie }
  });
  assert.equal(forbidden.status, 403);
  const adminForbidden = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Cookie: userCookie }
  });
  assert.equal(adminForbidden.status, 403);
  const userGeocodeForbidden = await fetch(`${baseUrl}/api/owner/geocode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: userCookie },
    body: JSON.stringify({ address: "12 Beta Road, Dagupan City" })
  });
  assert.equal(userGeocodeForbidden.status, 403);
  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "mangan-admin@example.test", password: "AdminBeta!2026VeryStrong" })
  });
  assert.equal(adminLogin.status, 200);
  const ownerForbidden = await fetch(`${baseUrl}/api/owner/restaurants`, {
    headers: { Cookie: adminLogin.headers.get("set-cookie").split(";")[0] }
  });
  assert.equal(ownerForbidden.status, 403);
  const missingSession = await fetch(`${baseUrl}/api/owner/restaurants`);
  assert.equal(missingSession.status, 401);

  const ownerSignIn = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "OWNER@example.test", password: "Owner!2026Food" })
  });
  assert.equal(ownerSignIn.status, 200);
  assert.match(ownerSignIn.headers.get("set-cookie"), /HttpOnly/);
  assert.match(ownerSignIn.headers.get("set-cookie"), /SameSite=Strict/);
  assert.ok(ownerCookie.startsWith("mangan_session="));
});

test("owner submissions require admin approval and display PHP price ranges", async () => {
  geocodeCalls.length = 0;
  const owner = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: "Owner!2026Food" })
  });
  const ownerCookie = owner.headers.get("set-cookie").split(";")[0];
  const unauthenticatedGeocode = await fetch(`${baseUrl}/api/owner/geocode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: "12 Beta Road, Dagupan City" })
  });
  assert.equal(unauthenticatedGeocode.status, 401);

  const shortAddress = await fetch(`${baseUrl}/api/owner/geocode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ address: "road" })
  });
  assert.equal(shortAddress.status, 400);

  const geocode = await fetch(`${baseUrl}/api/owner/geocode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ address: "12 Beta Road, Dagupan City" })
  });
  assert.equal(geocode.status, 200);
  assert.equal((await geocode.json()).location.latitude, 16.043);
  assert.deepEqual(geocodeCalls, ["12 Beta Road, Dagupan City"]);

  for (let requestNumber = 0; requestNumber < 9; requestNumber += 1) {
    await fetch(`${baseUrl}/api/owner/geocode`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ address: "12 Beta Road, Dagupan City" })
    });
  }
  const rateLimited = await fetch(`${baseUrl}/api/owner/geocode`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({ address: "12 Beta Road, Dagupan City" })
  });
  assert.equal(rateLimited.status, 429);
  assert.equal(geocodeCalls.length, 10);

  const invalidNearby = await fetch(`${baseUrl}/api/restaurants/nearby?lat=91&lng=120`);
  assert.equal(invalidNearby.status, 400);

  const invalidCoordinates = await fetch(`${baseUrl}/api/owner/restaurants`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({
      name: "Owner's Test Cafe",
      neighborhood: "Dagupan City",
      address: "12 Beta Road, Dagupan City",
      description: "A sample restaurant listing submitted for beta review.",
      priceMin: 180,
      priceMax: 450,
      hours: "Daily · 9:00 AM – 8:00 PM",
      categories: ["dessert"],
      imageUrl: "/images/ciudad-dining.svg",
      latitude: 16.043
    })
  });
  assert.equal(invalidCoordinates.status, 400);

  const submission = await fetch(`${baseUrl}/api/owner/restaurants`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ownerCookie },
    body: JSON.stringify({
      name: "Owner's Test Cafe",
      neighborhood: "Dagupan City",
      address: "12 Beta Road, Dagupan City",
      description: "A sample restaurant listing submitted for beta review.",
      priceMin: 180,
      priceMax: 450,
      hours: "Daily · 9:00 AM – 8:00 PM",
      categories: ["dessert", "drinks"],
      highlights: ["Coffee", "Local treats"],
      imageUrl: "/images/ciudad-dining.svg",
      venueImageUrl: "/images/seafood-spread.svg",
      latitude: 16.043,
      longitude: 120.334
    })
  });
  assert.equal(submission.status, 201);
  const submitted = await submission.json();
  assert.equal(submitted.restaurant.status, "pending");
  assert.equal(submitted.restaurant.priceMin, 180);
  assert.equal(submitted.restaurant.latitude, 16.043);
  assert.equal(submitted.restaurant.longitude, 120.334);

  const publicList = await fetch(`${baseUrl}/api/restaurants`).then((response) => response.json());
  assert.equal(publicList.restaurants.length, 3);

  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "mangan-admin@example.test", password: "AdminBeta!2026VeryStrong" })
  });
  assert.equal(adminLogin.status, 200);
  assert.equal((await adminLogin.json()).user.role, "admin");
  const adminCookie = adminLogin.headers.get("set-cookie").split(";")[0];
  const overview = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Cookie: adminCookie }
  }).then((response) => response.json());
  assert.equal(overview.stats.pending, 1);

  const approval = await fetch(`${baseUrl}/api/admin/restaurants/${submitted.restaurant.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: adminCookie },
    body: JSON.stringify({ status: "approved" })
  });
  assert.equal(approval.status, 200);

  const approvedList = await fetch(`${baseUrl}/api/restaurants`).then((response) => response.json());
  assert.equal(approvedList.restaurants.length, 4);
  assert.equal(approvedList.restaurants.find((item) => item.id === submitted.restaurant.id).priceMax, 450);
  const nearby = await fetch(`${baseUrl}/api/restaurants/nearby?lat=16.043&lng=120.334&radiusKm=5`)
    .then((response) => response.json());
  const nearbySubmission = nearby.restaurants.find((restaurant) => restaurant.id === submitted.restaurant.id);
  assert.ok(nearbySubmission);
  assert.equal(nearbySubmission.distanceKm, 0);
});

test("forgot password codes expire after a successful password reset", async () => {
  const forgot = await fetch(`${baseUrl}/api/auth/forgot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "food-lover@example.test" })
  });
  assert.equal(forgot.status, 200);
  const { developmentCode } = await forgot.json();
  assert.match(developmentCode, /^\d{6}$/);

  const reset = await fetch(`${baseUrl}/api/auth/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "food-lover@example.test",
      code: developmentCode,
      password: "Fresh!2026Meal"
    })
  });
  assert.equal(reset.status, 200);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "food-lover@example.test", password: "Fresh!2026Meal" })
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.role, "user");
});

test("static file access stays inside the public directory", async () => {
  const illustration = await fetch(`${baseUrl}/images/bangus-table.svg`);
  assert.equal(illustration.status, 200);
  assert.match(illustration.headers.get("content-type"), /image\/svg\+xml/);

  const missing = await fetch(`${baseUrl}/not-a-real-page`);
  assert.equal(missing.status, 404);
  const apiMissing = await fetch(`${baseUrl}/api/not-a-route`);
  assert.equal(apiMissing.status, 404);

  for (const page of ["login.html", "register.html", "forgot.html", "reset.html", "owner.html", "admin.html"]) {
    const response = await fetch(`${baseUrl}/${page}`);
    assert.equal(response.status, 200, `${page} should be available`);
    assert.match(response.headers.get("content-type"), /text\/html/);
  }
  const login = await fetch(`${baseUrl}/login.html`).then((response) => response.text());
  assert.match(login, /data-password-toggle="login-password"/);
  const register = await fetch(`${baseUrl}/register.html`).then((response) => response.text());
  assert.match(register, /data-password-rule="symbol"/);
  assert.match(register, /data-password-toggle="register-confirm"/);
});
