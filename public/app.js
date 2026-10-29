const state = {
  category: "all",
  query: "",
  sort: "recommended",
  restaurants: [],
  favoriteIds: new Set(),
  savedOnly: false
};

const grid = document.querySelector("#restaurant-grid");
const summary = document.querySelector("#results-summary");
const emptyState = document.querySelector("#empty-state");
const loadError = document.querySelector("#load-error");
const savedToggle = document.querySelector("#saved-toggle");
const detailDialog = document.querySelector("#detail-dialog");
const feedbackDialog = document.querySelector("#feedback-dialog");
const toast = document.querySelector("#toast");
let requestSequence = 0;
let searchTimer;
let toastTimer;
let activeMap = null;
let detailLoadSequence = 0;
let leafletPromise = null;
let currentUser = null;
let accountPromise = null;

function visitorId() {
  const key = "mangan-beta-visitor";
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

const clientId = visitorId();

async function apiRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  headers.set("X-Mangan-Visitor", clientId);
  if (options.body) headers.set("Content-Type", "application/json");

  let response;
  try {
    response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  } catch {
    throw new Error("Could not reach MANGAN. Check that the beta server is running.");
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("The server returned an unexpected response.");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "That request could not be completed.");
  return result;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function categoryLabel(category) {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function visibleRestaurants() {
  if (!state.savedOnly) return state.restaurants;
  return state.restaurants.filter((restaurant) => state.favoriteIds.has(restaurant.id));
}

function restaurantCard(restaurant) {
  const isSaved = state.favoriteIds.has(restaurant.id);
  const categories = restaurant.categories.slice(0, 2)
    .map((category) => `<span class="card-tag">${escapeHtml(categoryLabel(category))}</span>`)
    .join("");
  return `
    <article class="restaurant-card">
      <div class="card-image-wrap">
        <img class="card-image" src="${escapeHtml(restaurant.imageUrl)}" alt="Food served at ${escapeHtml(restaurant.name)}" loading="lazy">
        ${restaurant.featured ? '<span class="card-featured">Local favorite</span>' : ""}
        <button class="favorite-button" type="button" data-favorite-id="${restaurant.id}" aria-label="${isSaved ? "Remove" : "Save"} ${escapeHtml(restaurant.name)} ${isSaved ? "from" : "to"} your saved spots" aria-pressed="${isSaved}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.7c0 5.1-8.8 10-8.8 10s-8.8-4.9-8.8-10A4.6 4.6 0 0 1 12 6.3a4.6 4.6 0 0 1 8.8 2.4Z"/></svg>
        </button>
      </div>
      <div class="card-content">
        <div class="card-meta"><span class="neighborhood">${escapeHtml(restaurant.neighborhood)}</span><span class="rating"><span class="rating-star">★</span> ${restaurant.rating.toFixed(1)} <span class="neighborhood">(${restaurant.reviewCount})</span></span></div>
        <h3 class="card-title">${escapeHtml(restaurant.name)}</h3>
        <p class="card-description">${escapeHtml(restaurant.description)}</p>
        <div class="card-tags">${categories}</div>
        <div class="card-footer">        <span class="price-level">${priceRange(restaurant)}</span><button class="detail-button" type="button" data-detail-id="${restaurant.id}">View details <span>↗</span></button></div>
      </div>
    </article>`;
}

function priceRange(restaurant) {
  return `₱${Number(restaurant.priceMin).toLocaleString("en-PH")}–₱${Number(restaurant.priceMax).toLocaleString("en-PH")}`;
}

function renderRestaurants() {
  const restaurants = visibleRestaurants();
  grid.innerHTML = restaurants.map(restaurantCard).join("");
  grid.hidden = restaurants.length === 0;
  emptyState.hidden = restaurants.length !== 0;
  loadError.hidden = true;
  grid.setAttribute("aria-busy", "false");
  const noun = restaurants.length === 1 ? "spot" : "spots";
  summary.textContent = state.savedOnly
    ? `${restaurants.length} saved ${noun}`
    : `${restaurants.length} ${noun} to explore`;
  document.querySelector("#empty-title").textContent = state.savedOnly ? "No saved spots yet" : "No spots just yet";
  document.querySelector("#empty-description").textContent = state.savedOnly
    ? "Tap the heart on a restaurant to keep it here for later."
    : "Try a different search or food mood.";
}

function showLoadError() {
  grid.innerHTML = "";
  grid.hidden = true;
  emptyState.hidden = true;
  loadError.hidden = false;
  grid.setAttribute("aria-busy", "false");
  summary.textContent = "Couldn’t load spots";
}

async function loadRestaurants() {
  const sequence = ++requestSequence;
  grid.setAttribute("aria-busy", "true");
  loadError.hidden = true;
  const params = new URLSearchParams({ category: state.category, sort: state.sort });
  if (state.query) params.set("q", state.query);
  try {
    const result = await apiRequest(`/api/restaurants?${params}`);
    if (sequence !== requestSequence) return;
    state.restaurants = result.restaurants;
    renderRestaurants();
  } catch (error) {
    if (sequence !== requestSequence) return;
    showLoadError();
    showToast(error.message);
  }
}

async function loadFavorites() {
  try {
    const result = await apiRequest("/api/favorites");
    state.favoriteIds = new Set(result.favorites.map((restaurant) => restaurant.id));
    updateSavedCount();
    renderRestaurants();
  } catch (error) {
    showToast(error.message);
  }
}

function updateSavedCount() {
  document.querySelector("#saved-count").textContent = String(state.favoriteIds.size);
  savedToggle.setAttribute("aria-pressed", String(state.savedOnly));
  savedToggle.setAttribute("aria-label", state.savedOnly ? "Show all restaurants" : "Show saved restaurants");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3600);
}

async function openRestaurantDetails(id) {
  if (accountPromise) await accountPromise;
  if (!currentUser) {
    try {
      sessionStorage.setItem("mangan-pending-detail", String(id));
    } catch {
      // Ignore storage failures and continue to the sign-in page.
    }
    window.location.assign("/login.html?next=/");
    return;
  }
  const restaurant = state.restaurants.find((item) => item.id === id);
  if (!restaurant) {
    showToast("That restaurant isn’t in the current list. Refresh and try again.");
    return;
  }
  const body = document.querySelector("#detail-body");
  body.innerHTML = `
    <img class="detail-image" src="${escapeHtml(restaurant.venueImageUrl || restaurant.imageUrl)}" alt="Restaurant at ${escapeHtml(restaurant.name)}">
    <div class="detail-copy">
      <p class="eyebrow"><span class="eyebrow-line"></span> ${escapeHtml(restaurant.neighborhood.toUpperCase())}</p>
      <h2 id="detail-name">${escapeHtml(restaurant.name)}</h2>
      <p>${escapeHtml(restaurant.description)}</p>
      <div class="detail-facts">
        <div class="detail-fact"><span>Address</span>${escapeHtml(restaurant.address)}</div>
        <div class="detail-fact"><span>Hours</span>${escapeHtml(restaurant.hours)}</div>
        <div class="detail-fact"><span>Community rating</span>★ ${restaurant.rating.toFixed(1)} · ${restaurant.reviewCount} sample reviews</div>
        <div class="detail-fact"><span>Estimated price per person</span>${priceRange(restaurant)}</div>
      </div>
      <h3>Worth a try</h3>
      <div class="detail-highlights">${restaurant.highlights.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
      <div class="visit-tools">
        <section class="visit-map-panel" aria-labelledby="map-heading">
          <div class="visit-panel-heading"><div><h3 id="map-heading">Find your way</h3><p class="map-status" id="map-status" role="status">Finding the restaurant pin and checking for your location…</p></div></div>
          <div class="map-canvas" id="detail-map" role="region" aria-label="Map showing your location and the restaurant"></div>
          <div class="map-legend" id="map-legend" hidden><span class="map-legend-item"><span class="map-dot user"></span>Your location</span><span class="map-legend-item"><span class="map-dot"></span>Restaurant</span></div>
          <a class="map-directions" id="map-directions" href="#" target="_blank" rel="noopener noreferrer">Open turn-by-turn directions in Google Maps ↗</a>
        </section>
        <section class="weather-panel" aria-labelledby="weather-heading">
          <div class="visit-panel-heading"><div><h3 id="weather-heading">Weather for your visit</h3><p class="weather-status" id="weather-status" role="status">Checking current conditions…</p></div></div>
          <div id="weather-result" hidden></div>
        </section>
      </div>
      <p class="demo-note"><span aria-hidden="true">✳</span> Please confirm venue details before visiting.</p>
    </div>`;
  detailDialog.showModal();
  const sequence = ++detailLoadSequence;
  void loadRestaurantVisitInfo(restaurant, sequence);
}

function currentPosition() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 }
      );
    } catch {
      resolve(null);
    }
  });
}

function directionsUrl(restaurant, destination, userLocation) {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", destination
    ? `${destination.latitude},${destination.longitude}`
    : `${restaurant.name}, ${restaurant.address}`);
  if (userLocation) url.searchParams.set("origin", `${userLocation.latitude},${userLocation.longitude}`);
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}

function loadLeaflet() {
  if (window.L) return Promise.resolve(true);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(false), 8000);
    try {
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      stylesheet.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
      stylesheet.crossOrigin = "anonymous";

      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
      script.crossOrigin = "anonymous";
      script.onload = () => {
        window.clearTimeout(timeout);
        resolve(Boolean(window.L));
      };
      script.onerror = () => {
        window.clearTimeout(timeout);
        resolve(false);
      };
      stylesheet.onerror = () => {
        window.clearTimeout(timeout);
        resolve(false);
      };
      document.head.append(stylesheet, script);
    } catch {
      window.clearTimeout(timeout);
      resolve(false);
    }
  });
  return leafletPromise;
}

function renderRestaurantMap(restaurant, destination, userLocation, sequence, fallbackMessage = "") {
  if (sequence !== detailLoadSequence || !detailDialog.open) return;
  const mapContainer = document.querySelector("#detail-map");
  const status = document.querySelector("#map-status");
  const directions = document.querySelector("#map-directions");
  const legend = document.querySelector("#map-legend");
  legend.hidden = !destination || !userLocation;
  directions.href = directionsUrl(restaurant, destination, userLocation);

  if (!window.L) {
    status.textContent = "The interactive map is unavailable right now. Use Google Maps directions below.";
    mapContainer.hidden = true;
    return;
  }

  if (!destination && !userLocation) {
    status.textContent = fallbackMessage || "Allow location access or open directions to view this restaurant in Google Maps.";
    mapContainer.hidden = true;
    return;
  }

  mapContainer.hidden = false;
  if (activeMap) activeMap.remove();
  activeMap = null;
  const center = destination || userLocation;
  const points = [];
  const map = window.L.map(mapContainer, { scrollWheelZoom: false, tap: true });
  activeMap = map;
  const tiles = window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
  }).addTo(map);
  tiles.on("tileerror", () => {
    if (sequence === detailLoadSequence) {
      status.textContent = "Map tiles could not be loaded. Check your internet connection or use Google Maps directions.";
    }
  });

  const icon = (className, content) => window.L.divIcon({
    className: "",
    html: `<span class="mangan-marker ${className}">${content}</span>`,
    iconSize: [30, 36],
    iconAnchor: [15, 34]
  });

  if (destination) {
    const point = [destination.latitude, destination.longitude];
    points.push(point);
    window.L.marker(point, { icon: icon("restaurant-marker", "<span>✦</span>") })
      .addTo(map).bindPopup(`<strong>${escapeHtml(restaurant.name)}</strong><br>${escapeHtml(destination.formattedAddress || restaurant.address)}`);
  }
  if (userLocation) {
    const point = [userLocation.latitude, userLocation.longitude];
    points.push(point);
    window.L.marker(point, { icon: icon("user-marker", "") }).addTo(map).bindPopup("Your current location");
  }

  if (points.length > 1) {
    window.L.polyline(points, { color: "#3976c5", weight: 4, dashArray: "8 8", opacity: .8 }).addTo(map);
    status.textContent = "Blue line is a straight-line preview, not a road route. Open directions for turn-by-turn navigation.";
    map.fitBounds(points, { padding: [35, 35], maxZoom: 15 });
  } else {
    status.textContent = destination
      ? "Restaurant location shown. Allow location access to see your position on this map."
      : `${fallbackMessage || "Restaurant pin is not available yet."} Your current location is shown.`;
    map.setView([center.latitude, center.longitude], 15);
  }
  window.setTimeout(() => {
    if (sequence === detailLoadSequence && activeMap === map) map.invalidateSize();
  }, 100);
}

async function loadRestaurantVisitInfo(restaurant, sequence) {
  const weatherStatus = document.querySelector("#weather-status");
  const weatherResult = document.querySelector("#weather-result");
  const userLocationPromise = currentPosition();
  const mapPromise = loadLeaflet();
  let locationMessage = "";
  let locationResult = null;
  if (Number.isFinite(restaurant.latitude) && Number.isFinite(restaurant.longitude)) {
    locationResult = {
      latitude: restaurant.latitude,
      longitude: restaurant.longitude,
      formattedAddress: restaurant.address
    };
  } else {
    try {
      const result = await apiRequest(`/api/restaurants/${restaurant.id}/location`);
      locationResult = result.location;
      locationMessage = result.message || "";
    } catch (error) {
      locationMessage = error.message;
    }
  }
  if (sequence !== detailLoadSequence || !detailDialog.open) return;

  let destination = locationResult
    ? { latitude: locationResult.latitude, longitude: locationResult.longitude, formattedAddress: locationResult.formattedAddress }
    : null;
  const mapStatus = document.querySelector("#map-status");
  if (!destination) {
    mapStatus.textContent = locationMessage || "Restaurant pin unavailable. Allow location access to center a map nearby, or use Google Maps directions.";
  }
  void mapPromise.then(() => {
    if (sequence !== detailLoadSequence || !detailDialog.open) return;
    renderRestaurantMap(restaurant, destination, null, sequence, locationMessage);
    void userLocationPromise.then((userLocation) => {
      if (sequence !== detailLoadSequence || !detailDialog.open) return;
      renderRestaurantMap(restaurant, destination, userLocation, sequence, locationMessage);
    });
  });

  const weatherLocation = destination || await userLocationPromise;
  if (sequence !== detailLoadSequence || !detailDialog.open) return;
  if (!weatherLocation) {
    weatherStatus.textContent = "Weather needs a restaurant pin or your location. Allow location access to check nearby conditions.";
    return;
  }

  try {
    const { weather } = await apiRequest(
      `/api/weather?lat=${encodeURIComponent(weatherLocation.latitude)}&lng=${encodeURIComponent(weatherLocation.longitude)}`
    );
    if (sequence !== detailLoadSequence || !detailDialog.open) return;
    const advice = escapeHtml(weather.advice);
    const comfort = escapeHtml(weather.comfort);
    weatherStatus.textContent = `${weather.condition} · feels ${weather.comfort}`;
    weatherResult.hidden = false;
    weatherResult.innerHTML = `
      <p class="weather-value">${weather.temperatureC}°C</p>
      <p class="weather-condition">Feels like ${weather.feelsLikeC}°C · ${escapeHtml(weather.condition)}</p>
      <p class="weather-advice">${advice}</p>
      <p class="weather-source">${weather.humidityPercent === null ? "" : `Humidity ${weather.humidityPercent}% · `}Current ${comfort} conditions · ${escapeHtml(weather.source)}</p>`;
  } catch (error) {
    if (sequence !== detailLoadSequence || !detailDialog.open) return;
    weatherStatus.textContent = error.message;
  }
}

detailDialog.addEventListener("close", () => {
  detailLoadSequence += 1;
  if (activeMap) {
    activeMap.remove();
    activeMap = null;
  }
});

async function toggleFavorite(button) {
  const restaurantId = Number(button.dataset.favoriteId);
  const isSaved = state.favoriteIds.has(restaurantId);
  button.disabled = true;
  try {
    await apiRequest(isSaved ? `/api/favorites/${restaurantId}` : "/api/favorites", {
      method: isSaved ? "DELETE" : "POST",
      ...(!isSaved && { body: JSON.stringify({ restaurantId }) })
    });
    if (isSaved) state.favoriteIds.delete(restaurantId);
    else state.favoriteIds.add(restaurantId);
    updateSavedCount();
    renderRestaurants();
    showToast(isSaved ? "Removed from your saved spots." : "Saved for your next food adventure.");
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

document.querySelectorAll(".category-chip").forEach((button) => {
  button.addEventListener("click", () => {
    state.category = button.dataset.category;
    document.querySelectorAll(".category-chip").forEach((chip) => {
      const active = chip === button;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", String(active));
    });
    loadRestaurants();
  });
});

document.querySelector("#search-input").addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadRestaurants, 220);
});

document.querySelector("#sort-select").addEventListener("change", (event) => {
  state.sort = event.target.value;
  loadRestaurants();
});

grid.addEventListener("click", (event) => {
  const favoriteButton = event.target.closest("[data-favorite-id]");
  const detailsButton = event.target.closest("[data-detail-id]");
  if (favoriteButton) toggleFavorite(favoriteButton);
  if (detailsButton) openRestaurantDetails(Number(detailsButton.dataset.detailId));
});

savedToggle.addEventListener("click", () => {
  state.savedOnly = !state.savedOnly;
  updateSavedCount();
  renderRestaurants();
  document.querySelector("#discover").scrollIntoView({ behavior: "smooth" });
});

document.querySelector("#clear-filters").addEventListener("click", () => {
  state.category = "all";
  state.query = "";
  state.savedOnly = false;
  document.querySelector("#search-input").value = "";
  document.querySelector("#sort-select").value = "recommended";
  state.sort = "recommended";
  document.querySelectorAll(".category-chip").forEach((chip) => {
    const active = chip.dataset.category === "all";
    chip.classList.toggle("is-active", active);
    chip.setAttribute("aria-pressed", String(active));
  });
  updateSavedCount();
  loadRestaurants();
});

document.querySelector("#retry-load").addEventListener("click", loadRestaurants);

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => detailDialog.close());
});
document.querySelectorAll("[data-close-feedback]").forEach((button) => {
  button.addEventListener("click", () => feedbackDialog.close());
});
[detailDialog, feedbackDialog].forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

document.querySelector("#feedback-open").addEventListener("click", () => feedbackDialog.showModal());
document.querySelector("#feedback-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button[type=submit]");
  const status = document.querySelector("#feedback-message-status");
  const body = Object.fromEntries(new FormData(form));
  submit.disabled = true;
  status.textContent = "";
  status.classList.remove("is-error");
  try {
    await apiRequest("/api/feedback", { method: "POST", body: JSON.stringify(body) });
    form.reset();
    status.textContent = "Thank you — your feedback is in!";
    showToast("Thanks for helping shape MANGAN.");
    setTimeout(() => feedbackDialog.close(), 900);
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("is-error");
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#menu-toggle").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  button.setAttribute("aria-label", expanded ? "Open navigation" : "Close navigation");
  document.querySelector(".main-nav").classList.toggle("is-open", !expanded);
});

async function loadAccount() {
  const accountLink = document.querySelector("#account-link");
  const logoutButton = document.querySelector("#logout-button");
  try {
    const { user } = await apiRequest("/api/auth/me");
    currentUser = user || null;
    if (!user) return;
    accountLink.href = user.role === "admin" ? "/admin.html" : user.role === "owner" ? "/owner.html" : "/";
    accountLink.textContent = user.role === "admin" ? "Admin dashboard" :
      user.role === "owner" ? "Owner dashboard" : `Hi, ${user.name.split(" ")[0]}`;
    logoutButton.hidden = false;
    logoutButton.addEventListener("click", async () => {
      logoutButton.disabled = true;
      try {
        await apiRequest("/api/auth/logout", { method: "POST" });
        window.location.reload();
      } catch (error) {
        logoutButton.disabled = false;
        showToast(error.message);
      }
    });
  } catch (error) {
    showToast(error.message);
  }
}

document.querySelectorAll(".main-nav a").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelector(".main-nav").classList.remove("is-open");
    document.querySelector("#menu-toggle").setAttribute("aria-expanded", "false");
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    document.querySelector("#search-input").focus();
  }
});

function resumePendingDetail() {
  let pendingId;
  try {
    pendingId = sessionStorage.getItem("mangan-pending-detail");
  } catch {
    return;
  }
  if (!pendingId || !currentUser) return;
  sessionStorage.removeItem("mangan-pending-detail");
  const id = Number(pendingId);
  if (Number.isSafeInteger(id)) openRestaurantDetails(id);
}

updateSavedCount();
accountPromise = loadAccount();
Promise.all([loadRestaurants(), loadFavorites(), accountPromise]).then(resumePendingDetail);
