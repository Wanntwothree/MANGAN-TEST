CREATE TABLE IF NOT EXISTS beta_feedback (
  id INTEGER PRIMARY KEY,
  topic TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_beta_feedback_created
  ON beta_feedback (created_at DESC);
