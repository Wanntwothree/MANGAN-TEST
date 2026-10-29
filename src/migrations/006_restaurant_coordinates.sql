ALTER TABLE restaurants
  ADD COLUMN latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);

ALTER TABLE restaurants
  ADD COLUMN longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

CREATE INDEX IF NOT EXISTS idx_restaurants_map_coordinates
  ON restaurants (status, latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
