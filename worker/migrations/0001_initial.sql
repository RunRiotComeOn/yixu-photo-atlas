CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  city TEXT NOT NULL DEFAULT 'Unknown place',
  country TEXT NOT NULL DEFAULT '',
  captured_at TEXT,
  uploaded_at TEXT NOT NULL,
  caption TEXT
);

CREATE INDEX IF NOT EXISTS photos_uploaded_at_idx ON photos(uploaded_at);
CREATE INDEX IF NOT EXISTS photos_location_idx ON photos(latitude, longitude);

CREATE TABLE IF NOT EXISTS upload_sessions (
  token TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS upload_sessions_expires_at_idx ON upload_sessions(expires_at);
