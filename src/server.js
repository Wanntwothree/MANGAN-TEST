const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const { openDatabase } = require("./database");
const { AuthError, createAuthService } = require("./auth-service");
const { createGoogleMapsService } = require("./google-maps-service");
const { createRestaurantRepository } = require("./restaurant-repository");
const { createWeatherService } = require("./weather-service");

const publicDirectory = path.join(__dirname, "..", "public");
const databasePath = process.env.DATABASE_PATH || path.join(__dirname, "..", "data", "mangan.sqlite");
const maxBodyLength = 10_000;
const sessionCookie = "mangan_session";
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};
const categories = new Set(["all", "meat", "seafood", "drinks", "dessert"]);
const visitorIdPattern = /^[a-f0-9-]{36}$/i;
const restaurantImages = new Set([
  "/images/bangus-table.svg",
  "/images/ciudad-dining.svg",
  "/images/seafood-spread.svg"
]);

function cookieValue(request, name) {
  const prefix = `${name}=`;
  for (const part of (request.headers.cookie || "").split(";")) {
    const cookie = part.trim();
    if (!cookie.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(cookie.slice(prefix.length));
    } catch {
      return null;
    }
  }
  return null;
}

function setSessionCookie(response, token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${sessionCookie}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`);
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

function validateRestaurant(body) {
  const text = (key, max) => typeof body[key] === "string" ? body[key].trim().slice(0, max) : "";
  const name = text("name", 100);
  const neighborhood = text("neighborhood", 100);
  const address = text("address", 240);
  const description = text("description", 500);
  const hours = text("hours", 100);
  const priceMin = Number(body.priceMin);
  const priceMax = Number(body.priceMax);
  const coordinate = (value) => {
    if (value === undefined || value === "" || value === null) return null;
    if (typeof value !== "number" && typeof value !== "string") return Number.NaN;
    if (typeof value === "string" && !value.trim()) return Number.NaN;
    return Number(value);
  };
  const latitude = coordinate(body.latitude);
  const longitude = coordinate(body.longitude);
  const categoriesInput = Array.isArray(body.categories) ? body.categories : [];
  const categoriesValue = [...new Set(categoriesInput.filter((item) =>
    typeof item === "string" && ["meat", "seafood", "drinks", "dessert"].includes(item)
  ))];
  const highlightsInput = Array.isArray(body.highlights)
    ? body.highlights
    : typeof body.highlights === "string" ? body.highlights.split(",") : [];
  const highlights = highlightsInput
    .filter((item) => typeof item === "string")
    .map((item) => item.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 5);
  const imageUrl = text("imageUrl", 100);
  const venueImageUrl = text("venueImageUrl", 100) || imageUrl;

  if (name.length < 3 || neighborhood.length < 2 || address.length < 5) {
    throw new AuthError(400, "Enter the restaurant name, neighborhood, and complete address.");
  }
  if (description.length < 15 || !hours) {
    throw new AuthError(400, "Add a description (at least 15 characters) and opening hours.");
  }
  if (!Number.isInteger(priceMin) || !Number.isInteger(priceMax) ||
      priceMin < 1 || priceMax < priceMin || priceMax > 100_000) {
    throw new AuthError(400, "Enter a valid price range in Philippine pesos.");
  }
  if ((latitude === null) !== (longitude === null) ||
      (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
      (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
    throw new AuthError(400, "Enter both valid map coordinates: latitude from -90 to 90 and longitude from -180 to 180.");
  }
  if (!categoriesValue.length || !restaurantImages.has(imageUrl) || !restaurantImages.has(venueImageUrl)) {
    throw new AuthError(400, "Choose a food category and a photo from the beta gallery.");
  }
  return { name, neighborhood, address, description, hours, priceMin, priceMax, categories: categoriesValue, highlights, imageUrl, venueImageUrl, latitude, longitude };
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (tooLarge) return;
      if (Buffer.byteLength(body) + Buffer.byteLength(chunk) > maxBodyLength) {
        tooLarge = true;
        body = "";
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        return;
      }
      try {
        const payload = body ? JSON.parse(body) : {};
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          reject(Object.assign(new Error("Request body must be a JSON object."), { status: 400 }));
          return;
        }
        resolve(payload);
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function visitorIdFrom(request) {
  const visitorId = request.headers["x-mangan-visitor"];
  return typeof visitorId === "string" && visitorIdPattern.test(visitorId) ? visitorId : null;
}

function staticPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const relativePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const filePath = path.resolve(publicDirectory, relativePath);
  return filePath.startsWith(`${publicDirectory}${path.sep}`) ? filePath : null;
}

function createApp(options = {}) {
  const database = openDatabase(options.databasePath || databasePath);
  const repository = createRestaurantRepository(database);
  const auth = createAuthService(database);
  const maps = options.mapsService || createGoogleMapsService({
    apiKey: options.googleMapsApiKey ?? process.env.GOOGLE_MAPS_API_KEY,
    countryCode: options.googleMapsCountry ?? process.env.GOOGLE_MAPS_COUNTRY ?? "PH"
  });
  const weather = options.weatherService || createWeatherService();
  const publicGeocodeLimits = new Map();
  const geocodeRateLimits = new Map();
  auth.seedAdmin(
    process.env.ADMIN_EMAIL || "admin@mangan.com",
    process.env.ADMIN_PASSWORD || "admin_123"
  );

  const server = http.createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org https://tile.openstreetmap.org; style-src 'self' https://unpkg.com; font-src 'self'; script-src 'self' https://unpkg.com; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");

    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const origin = request.headers.origin;
      const protocol = request.socket.encrypted ? "https" : "http";
      if (origin && origin !== `${protocol}://${request.headers.host}`) {
        sendJson(response, 403, { error: "Cross-origin requests are not allowed." });
        return;
      }
    }

    let url;
    try {
      url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    } catch {
      sendJson(response, 400, { error: "Request URL is invalid." });
      return;
    }

    try {
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url, repository, auth, database, maps, weather, geocodeRateLimits, publicGeocodeLimits);
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { error: "Method not allowed." });
        return;
      }

      let filePath;
      try {
        filePath = staticPath(url.pathname);
      } catch {
        sendJson(response, 400, { error: "Request path is invalid." });
        return;
      }
      if (!filePath) {
        sendJson(response, 403, { error: "That file is not available." });
        return;
      }

      fs.readFile(filePath, (error, content) => {
        if (error) {
          sendJson(response, 404, { error: "Page not found." });
          return;
        }
        response.writeHead(200, {
          "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
          "Content-Length": content.length,
          "Cache-Control": path.extname(filePath) === ".html" ? "no-cache" : "public, max-age=3600"
        });
        response.end(request.method === "HEAD" ? undefined : content);
      });
    } catch (error) {
      if (error.status && !response.headersSent) {
        sendJson(response, error.status, { error: error.message });
      } else {
        console.error("Request failed:", error);
      }
      if (response.headersSent) response.destroy();
      else if (!error.status) sendJson(response, 500, { error: "Something went wrong. Please try again." });
    }
  });

  return { server, database };
}

function authorizedUser(request, response, auth, role) {
  const user = auth.userForSession(cookieValue(request, sessionCookie));
  if (!user) {
    sendJson(response, 401, { error: "Sign in to continue." });
    return null;
  }
  if (role && user.role !== role) {
    sendJson(response, 403, { error: "This page is only available to the correct account role." });
    return null;
  }
  return user;
}

async function handleApi(request, response, url, repository, auth, database, maps, weather, geocodeRateLimits, publicGeocodeLimits) {
  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    sendJson(response, 200, { user: auth.userForSession(cookieValue(request, sessionCookie)) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readJson(request);
    const user = auth.register(body);
    const session = auth.issueSession(user.id);
    setSessionCookie(response, session.token, session.expiresAt);
    sendJson(response, 201, { user });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJson(request);
    const user = auth.login(body);
    const session = auth.issueSession(user.id);
    setSessionCookie(response, session.token, session.expiresAt);
    sendJson(response, 200, { user });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    auth.revokeSession(cookieValue(request, sessionCookie));
    clearSessionCookie(response);
    sendJson(response, 200, { loggedOut: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/forgot") {
    if (process.env.NODE_ENV === "production") {
      throw new AuthError(503, "Password recovery email is not configured. Contact the MANGAN administrator.");
    }
    const body = await readJson(request);
    const code = auth.requestPasswordReset(body.email);
    sendJson(response, 200, {
      message: "If the account exists, a local beta reset code is ready.",
      ...(code && { developmentCode: code })
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/reset") {
    const body = await readJson(request);
    auth.resetPassword(body);
    clearSessionCookie(response);
    sendJson(response, 200, { reset: true, message: "Password updated. You can sign in with your new password." });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { status: "ok", service: "mangan-beta" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/restaurants") {
    const category = (url.searchParams.get("category") || "all").toLowerCase();
    const sort = url.searchParams.get("sort") || "recommended";
    const query = url.searchParams.get("q") || "";
    if (!categories.has(category)) {
      sendJson(response, 400, { error: "Choose a supported food category." });
      return;
    }
    if (!["recommended", "rating", "name"].includes(sort)) {
      sendJson(response, 400, { error: "Choose a supported sort order." });
      return;
    }
    if (query.length > 100) {
      sendJson(response, 400, { error: "Search text must be 100 characters or fewer." });
      return;
    }
    sendJson(response, 200, { restaurants: repository.list({ category, sort, query }) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/restaurants/nearby") {
    const latitude = Number(url.searchParams.get("lat"));
    const longitude = Number(url.searchParams.get("lng"));
    const radiusKm = url.searchParams.has("radiusKm") ? Number(url.searchParams.get("radiusKm")) : 25;
    if (!url.searchParams.has("lat") || !url.searchParams.has("lng") ||
        !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new AuthError(400, "Provide a valid map center using lat (-90 to 90) and lng (-180 to 180).");
    }
    if (!Number.isFinite(radiusKm) || radiusKm < 0.1 || radiusKm > 100) {
      throw new AuthError(400, "Choose a search radius from 0.1 to 100 kilometers.");
    }
    sendJson(response, 200, { restaurants: repository.listNearby({ latitude, longitude, radiusKm }) });
    return;
  }

  const locationMatch = url.pathname.match(/^\/api\/restaurants\/(\d+)\/location$/);
  if (request.method === "GET" && locationMatch) {
    const restaurant = repository.getById(Number(locationMatch[1]));
    if (!restaurant) throw new AuthError(404, "That restaurant is not available.");
    if (restaurant.latitude !== null && restaurant.longitude !== null) {
      sendJson(response, 200, {
        location: {
          latitude: restaurant.latitude,
          longitude: restaurant.longitude,
          formattedAddress: restaurant.address
        }
      });
      return;
    }
    if (!maps.isConfigured) {
      sendJson(response, 200, {
        location: null,
        message: "Exact pins need the server's Google Maps key or coordinates supplied by the restaurant owner."
      });
      return;
    }

    const clientAddress = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    const previous = publicGeocodeLimits.get(clientAddress);
    const bucket = !previous || now - previous.startedAt >= 60_000
      ? { startedAt: now, count: 0 }
      : previous;
    if (bucket.count >= 20) {
      throw new AuthError(429, "Too many map lookups. Please wait a minute and try again.");
    }
    bucket.count += 1;
    publicGeocodeLimits.set(clientAddress, bucket);

    const location = await maps.geocode(`${restaurant.name}, ${restaurant.address}, ${restaurant.neighborhood}, Philippines`);
    repository.saveGeocodedLocation(restaurant.id, location.latitude, location.longitude);
    sendJson(response, 200, { location });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/weather") {
    const latitude = Number(url.searchParams.get("lat"));
    const longitude = Number(url.searchParams.get("lng"));
    if (!url.searchParams.has("lat") || !url.searchParams.has("lng") ||
        !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new AuthError(400, "Provide valid weather coordinates: latitude from -90 to 90 and longitude from -180 to 180.");
    }
    sendJson(response, 200, { weather: await weather.current(latitude, longitude) });
    return;
  }

  if (url.pathname.startsWith("/api/owner/")) {
    const owner = authorizedUser(request, response, auth, "owner");
    if (!owner) return;

    if (request.method === "POST" && url.pathname === "/api/owner/geocode") {
      const body = await readJson(request);
      const address = typeof body.address === "string" ? body.address.trim() : "";
      if (address.length < 5 || address.length > 240) {
        throw new AuthError(400, "Enter an address between 5 and 240 characters.");
      }
      if (!maps.isConfigured) {
        throw new AuthError(503, "Google Maps geocoding is not configured on this server.");
      }

      const now = Date.now();
      const previous = geocodeRateLimits.get(owner.id);
      const bucket = !previous || now - previous.startedAt >= 60_000
        ? { startedAt: now, count: 0 }
        : previous;
      if (bucket.count >= 10) {
        throw new AuthError(429, "Too many address lookups. Please wait a minute and try again.");
      }
      bucket.count += 1;
      geocodeRateLimits.set(owner.id, bucket);

      sendJson(response, 200, { location: await maps.geocode(address) });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/owner/restaurants") {
      sendJson(response, 200, { restaurants: repository.listByOwner(owner.id) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/owner/restaurants") {
      const restaurant = validateRestaurant(await readJson(request));
      sendJson(response, 201, { restaurant: repository.createOwnedRestaurant(owner.id, restaurant) });
      return;
    }
    const editMatch = url.pathname.match(/^\/api\/owner\/restaurants\/(\d+)$/);
    if (editMatch && request.method === "PATCH") {
      const restaurant = validateRestaurant(await readJson(request));
      const saved = repository.updateOwnedRestaurant(owner.id, Number(editMatch[1]), restaurant);
      if (!saved) throw new AuthError(404, "That restaurant was not found under your account.");
      sendJson(response, 200, { saved: true, status: "pending" });
      return;
    }
    if (editMatch && request.method === "DELETE") {
      const removed = repository.deleteOwnedRestaurant(owner.id, Number(editMatch[1]));
      if (!removed) throw new AuthError(404, "That restaurant was not found under your account.");
      sendJson(response, 200, { removed: true });
      return;
    }
  }

  if (url.pathname.startsWith("/api/admin/")) {
    const admin = authorizedUser(request, response, auth, "admin");
    if (!admin) return;

    if (request.method === "GET" && url.pathname === "/api/admin/overview") {
      const count = (sql) => database.prepare(sql).get().count;
      const restaurants = database.prepare(`
        SELECT restaurants.id, restaurants.name, restaurants.neighborhood,
          restaurants.status, restaurants.price_min AS priceMin,
          restaurants.price_max AS priceMax, restaurants.categories_json AS categories,
          restaurants.owner_id AS ownerId, users.name AS ownerName, users.email AS ownerEmail,
          restaurants.created_at AS createdAt
        FROM restaurants LEFT JOIN users ON users.id = restaurants.owner_id
        ORDER BY CASE restaurants.status WHEN 'pending' THEN 0 ELSE 1 END, restaurants.created_at DESC
      `).all().map((restaurant) => ({ ...restaurant, categories: JSON.parse(restaurant.categories) }));
      const feedback = database.prepare(`
        SELECT id, topic, message, created_at AS createdAt
        FROM beta_feedback ORDER BY created_at DESC LIMIT 30
      `).all();
      sendJson(response, 200, {
        stats: {
          users: count("SELECT COUNT(*) AS count FROM users WHERE role = 'user'"),
          owners: count("SELECT COUNT(*) AS count FROM users WHERE role = 'owner'"),
          restaurants: count("SELECT COUNT(*) AS count FROM restaurants"),
          pending: count("SELECT COUNT(*) AS count FROM restaurants WHERE status = 'pending'"),
          feedback: count("SELECT COUNT(*) AS count FROM beta_feedback")
        },
        users: auth.listUsers(),
        restaurants,
        feedback
      });
      return;
    }
    const restaurantMatch = url.pathname.match(/^\/api\/admin\/restaurants\/(\d+)$/);
    if (restaurantMatch && request.method === "PATCH") {
      const body = await readJson(request);
      if (!["approved", "rejected", "pending"].includes(body.status)) {
        throw new AuthError(400, "Choose an approved, rejected, or pending status.");
      }
      const result = database.prepare("UPDATE restaurants SET status = ? WHERE id = ?")
        .run(body.status, Number(restaurantMatch[1]));
      if (!result.changes) throw new AuthError(404, "Restaurant not found.");
      sendJson(response, 200, { status: body.status });
      return;
    }
    const userMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (userMatch && request.method === "PATCH") {
      const body = await readJson(request);
      if (typeof body.isActive !== "boolean" || !auth.setUserActive(Number(userMatch[1]), body.isActive)) {
        throw new AuthError(400, "That user could not be updated.");
      }
      sendJson(response, 200, { isActive: body.isActive });
      return;
    }
  }

  if (url.pathname === "/api/favorites") {
    const visitorId = visitorIdFrom(request);
    if (!visitorId) {
      sendJson(response, 400, { error: "Your browser session is missing. Refresh and try again." });
      return;
    }

    if (request.method === "GET") {
      sendJson(response, 200, { favorites: repository.getFavorites(visitorId) });
      return;
    }
    if (request.method === "POST") {
      const body = await readJson(request);
      const restaurantId = Number(body.restaurantId);
      if (!Number.isSafeInteger(restaurantId) || !repository.getById(restaurantId)) {
        sendJson(response, 400, { error: "Choose a restaurant from the list." });
        return;
      }
      repository.saveFavorite(visitorId, restaurantId);
      sendJson(response, 201, { saved: true });
      return;
    }
  }

  const favoriteMatch = url.pathname.match(/^\/api\/favorites\/(\d+)$/);
  if (request.method === "DELETE" && favoriteMatch) {
    const visitorId = visitorIdFrom(request);
    if (!visitorId) {
      sendJson(response, 400, { error: "Your browser session is missing. Refresh and try again." });
      return;
    }
    repository.removeFavorite(visitorId, Number(favoriteMatch[1]));
    sendJson(response, 200, { saved: false });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/feedback") {
    const body = await readJson(request);
    const topic = typeof body.topic === "string" ? body.topic.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!["bug", "idea", "other"].includes(topic)) {
      sendJson(response, 400, { error: "Choose a feedback topic." });
      return;
    }
    if (message.length < 8 || message.length > 1000) {
      sendJson(response, 400, { error: "Feedback must be between 8 and 1,000 characters." });
      return;
    }
    repository.saveFeedback({ topic, message });
    sendJson(response, 201, { received: true });
    return;
  }

  sendJson(response, 404, { error: "API route not found." });
}

function startServer() {
  const port = Number(process.env.PORT) || 3198;
  const host = process.env.HOST || "127.0.0.1";
  const app = createApp();
  app.server.listen(port, host, () => {
    const address = app.server.address();
    console.log(`MANGAN Beta is ready at http://${host}:${address.port}`);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      app.server.close(() => {
        app.database.close();
        process.exit(0);
      });
    });
  }
  return app;
}

module.exports = { createApp, startServer };
