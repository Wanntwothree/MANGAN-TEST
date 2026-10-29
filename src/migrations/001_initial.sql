CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  neighborhood TEXT NOT NULL,
  address TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NOT NULL,
  rating REAL NOT NULL CHECK (rating >= 0 AND rating <= 5),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  price_level TEXT NOT NULL,
  categories_json TEXT NOT NULL,
  highlights_json TEXT NOT NULL,
  hours TEXT NOT NULL,
  is_open INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0, 1)),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1))
);

CREATE TABLE IF NOT EXISTS favorites (
  visitor_id TEXT NOT NULL,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (visitor_id, restaurant_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurants_featured_rating
  ON restaurants (featured DESC, rating DESC);
CREATE INDEX IF NOT EXISTS idx_favorites_visitor
  ON favorites (visitor_id);

INSERT OR IGNORE INTO restaurants
  (id, slug, name, neighborhood, address, description, image_url, rating, review_count, price_level, categories_json, highlights_json, hours, is_open, featured)
VALUES
  (1, 'house-of-bangus', 'House of Bangus', 'Dagupan City', 'RBA Paramount Building, Old De Venecia Highway, Calasiao', 'A Pangasinan favorite known for bringing local bangus to the center of the table.', '/images/bangus-table.svg', 4.8, 128, '$$', '["seafood","meat"]', '["Bangus relleno","Pangasinan comfort food"]', 'Daily · 10:00 AM – 9:00 PM', 1, 1),
  (2, 'ciudad-elmina', 'Ciudad Elmina', 'Mayombo, Dagupan City', 'Arzadon Road, Mayombo, Dagupan City', 'A relaxed waterfront dining stop for long lunches, seafood plates, and easygoing gatherings.', '/images/ciudad-dining.svg', 4.7, 96, '$$', '["seafood","drinks","dessert"]', '["Fresh seafood","Group dining","Sweet finish"]', 'Daily · 11:00 AM – 10:00 PM', 1, 1),
  (3, 'matutina-gerrys', 'Matutina-Gerry’s Seafood House', 'Pantal, Dagupan City', 'De Venecia Road Extension, Barangay Pantal, Dagupan City', 'A local seafood-house pick for sharing a generous meal with family and friends.', '/images/seafood-spread.svg', 4.6, 84, '$$', '["seafood","meat","drinks"]', '["Seafood favorites","Family-style plates","Cold drinks"]', 'Daily · 10:00 AM – 9:00 PM', 1, 0);
