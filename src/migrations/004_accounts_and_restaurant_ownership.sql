CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'owner', 'admin')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS password_resets (
  email TEXT PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE restaurants ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE restaurants ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'
  CHECK (status IN ('pending', 'approved', 'rejected'));
ALTER TABLE restaurants ADD COLUMN price_min INTEGER NOT NULL DEFAULT 200 CHECK (price_min >= 0);
ALTER TABLE restaurants ADD COLUMN price_max INTEGER NOT NULL DEFAULT 500 CHECK (price_max >= price_min);
ALTER TABLE restaurants ADD COLUMN venue_image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE restaurants ADD COLUMN created_at TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_users_role_active ON users (role, is_active);
CREATE INDEX IF NOT EXISTS idx_sessions_user_expiry ON sessions (user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_restaurants_owner_status ON restaurants (owner_id, status);

UPDATE restaurants
SET price_min = CASE slug
    WHEN 'house-of-bangus' THEN 220
    WHEN 'ciudad-elmina' THEN 250
    ELSE 200
  END,
  price_max = CASE slug
    WHEN 'house-of-bangus' THEN 520
    WHEN 'ciudad-elmina' THEN 650
    ELSE 600
  END,
  created_at = CURRENT_TIMESTAMP,
  image_url = CASE slug
    WHEN 'house-of-bangus' THEN '/images/bangus-table.svg'
    WHEN 'ciudad-elmina' THEN '/images/ciudad-dining.svg'
    ELSE '/images/seafood-spread.svg'
  END,
  venue_image_url = CASE slug
    WHEN 'house-of-bangus' THEN '/images/bangus-table.svg'
    WHEN 'ciudad-elmina' THEN '/images/ciudad-dining.svg'
    ELSE '/images/seafood-spread.svg'
  END;
