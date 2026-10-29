const crypto = require("node:crypto");

function createRestaurantRepository(database) {
  const restaurantSelect = `
    SELECT restaurants.id, restaurants.slug, restaurants.name, restaurants.neighborhood,
      restaurants.address, restaurants.description, restaurants.image_url AS imageUrl,
      restaurants.venue_image_url AS venueImageUrl, restaurants.rating,
      restaurants.review_count AS reviewCount, restaurants.price_min AS priceMin,
      restaurants.price_max AS priceMax, restaurants.price_level AS priceLevel,
      restaurants.categories_json AS categories, restaurants.highlights_json AS highlights,
      restaurants.hours, restaurants.is_open AS isOpen, restaurants.featured,
      restaurants.status, restaurants.owner_id AS ownerId,
      restaurants.latitude, restaurants.longitude,
      restaurants.created_at AS createdAt
    FROM restaurants
  `;

  function toRestaurant(row) {
    return {
      ...row,
      categories: JSON.parse(row.categories),
      highlights: JSON.parse(row.highlights),
      isOpen: Boolean(row.isOpen),
      featured: Boolean(row.featured)
    };
  }

  function list({ query = "", category = "all", sort = "recommended" } = {}) {
    const restaurants = database.prepare(`${restaurantSelect} WHERE restaurants.status = 'approved' ORDER BY restaurants.featured DESC, restaurants.rating DESC`)
      .all()
      .map(toRestaurant);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const result = restaurants.filter((restaurant) => {
      const matchesQuery = !normalizedQuery || [
        restaurant.name,
        restaurant.neighborhood,
        restaurant.address,
        restaurant.description,
        ...restaurant.categories,
        ...restaurant.highlights
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
      const matchesCategory = category === "all" || restaurant.categories.includes(category);
      return matchesQuery && matchesCategory;
    });

    if (sort === "rating") result.sort((a, b) => b.rating - a.rating);
    if (sort === "name") result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  function listNearby({ latitude, longitude, radiusKm }) {
    const restaurants = database.prepare(`
      ${restaurantSelect}
      WHERE restaurants.status = 'approved'
        AND restaurants.latitude IS NOT NULL
        AND restaurants.longitude IS NOT NULL
    `).all().map(toRestaurant);
    return restaurants.map((restaurant) => ({
      ...restaurant,
      distanceKm: distanceBetween(latitude, longitude, restaurant.latitude, restaurant.longitude)
    }))
      .filter((restaurant) => restaurant.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 50)
      .map((restaurant) => ({ ...restaurant, distanceKm: Math.round(restaurant.distanceKm * 100) / 100 }));
  }

  return {
    list,
    listNearby,
    getById(id) {
      const row = database.prepare(`${restaurantSelect} WHERE restaurants.id = ? AND restaurants.status = 'approved'`).get(id);
      return row ? toRestaurant(row) : null;
    },
    saveGeocodedLocation(id, latitude, longitude) {
      return database.prepare(`
        UPDATE restaurants SET latitude = ?, longitude = ?
        WHERE id = ? AND status = 'approved' AND latitude IS NULL AND longitude IS NULL
      `).run(latitude, longitude, id).changes > 0;
    },
    getFavorites(visitorId) {
      return database.prepare(`
        ${restaurantSelect}
        JOIN favorites ON favorites.restaurant_id = restaurants.id
      WHERE favorites.visitor_id = ? AND restaurants.status = 'approved'
        ORDER BY favorites.created_at DESC
      `).all(visitorId).map(toRestaurant);
    },
    saveFavorite(visitorId, restaurantId) {
      database.prepare("INSERT OR IGNORE INTO favorites (visitor_id, restaurant_id) VALUES (?, ?)")
        .run(visitorId, restaurantId);
    },
    removeFavorite(visitorId, restaurantId) {
      database.prepare("DELETE FROM favorites WHERE visitor_id = ? AND restaurant_id = ?")
        .run(visitorId, restaurantId);
    },
    listByOwner(ownerId) {
      return database.prepare(`${restaurantSelect} WHERE restaurants.owner_id = ? ORDER BY restaurants.created_at DESC`)
        .all(ownerId).map(toRestaurant);
    },
    createOwnedRestaurant(ownerId, restaurant) {
      const result = database.prepare(`
        INSERT INTO restaurants
          (slug, name, neighborhood, address, description, image_url, venue_image_url,
           rating, review_count, price_level, price_min, price_max, categories_json,
           highlights_json, hours, is_open, featured, owner_id, status, latitude, longitude, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, '₱', ?, ?, ?, ?, ?, 1, 0, ?, 'pending', ?, ?, CURRENT_TIMESTAMP)
      `).run(
        `${slugify(restaurant.name)}-${crypto.randomUUID().slice(0, 8)}`,
        restaurant.name,
        restaurant.neighborhood,
        restaurant.address,
        restaurant.description,
        restaurant.imageUrl,
        restaurant.venueImageUrl,
        restaurant.priceMin,
        restaurant.priceMax,
        JSON.stringify(restaurant.categories),
        JSON.stringify(restaurant.highlights),
        restaurant.hours,
        ownerId,
        restaurant.latitude,
        restaurant.longitude
      );
      return toRestaurant(database.prepare(`${restaurantSelect} WHERE restaurants.id = ?`).get(Number(result.lastInsertRowid)));
    },
    updateOwnedRestaurant(ownerId, restaurantId, restaurant) {
      const result = database.prepare(`
        UPDATE restaurants SET name = ?, neighborhood = ?, address = ?, description = ?,
          image_url = ?, venue_image_url = ?, price_min = ?, price_max = ?,
          categories_json = ?, highlights_json = ?, hours = ?, latitude = ?, longitude = ?, status = 'pending',
          featured = 0
        WHERE id = ? AND owner_id = ?
      `).run(
        restaurant.name,
        restaurant.neighborhood,
        restaurant.address,
        restaurant.description,
        restaurant.imageUrl,
        restaurant.venueImageUrl,
        restaurant.priceMin,
        restaurant.priceMax,
        JSON.stringify(restaurant.categories),
        JSON.stringify(restaurant.highlights),
        restaurant.hours,
        restaurant.latitude,
        restaurant.longitude,
        restaurantId,
        ownerId
      );
      return result.changes > 0;
    },
    deleteOwnedRestaurant(ownerId, restaurantId) {
      return database.prepare("DELETE FROM restaurants WHERE id = ? AND owner_id = ?")
        .run(restaurantId, ownerId).changes > 0;
    },
    saveFeedback({ topic, message }) {
      return database.prepare(`
        INSERT INTO beta_feedback (topic, message) VALUES (?, ?)
      `).run(topic, message);
    }
  };
}

function distanceBetween(latitudeA, longitudeA, latitudeB, longitudeB) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const haversine = Math.min(1, Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) *
    Math.sin(longitudeDelta / 2) ** 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "restaurant";
}

module.exports = { createRestaurantRepository };
