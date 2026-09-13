use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

/// Wraps the SQLite connection so it can be stored as Tauri managed state
/// and safely shared across command invocations.
pub struct Db(pub Mutex<Connection>);

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS bundles (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
    id            TEXT PRIMARY KEY,
    bundle_id     TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
    title         TEXT NOT NULL DEFAULT '',
    content       TEXT NOT NULL DEFAULT '',
    pinned        INTEGER NOT NULL DEFAULT 0,
    position      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    sync_version  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tags (
    id          TEXT PRIMARY KEY,
    bundle_id   TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       TEXT
);

CREATE TABLE IF NOT EXISTS note_tags (
    note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id   TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_notes_bundle ON notes(bundle_id);
CREATE INDEX IF NOT EXISTS idx_tags_bundle ON tags(bundle_id);
"#;

/// Resolves `<app_data_dir>/paki-notes.sqlite3`, creating the parent
/// directory if it doesn't exist yet.
pub fn db_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("could not resolve app data dir");
    std::fs::create_dir_all(&dir).expect("could not create app data dir");
    dir.join("paki-notes.sqlite3")
}

/// Opens the database (creating the file if needed) and applies the schema.
/// Safe to call every launch — every statement is idempotent.
pub fn init(app: &tauri::AppHandle) -> Connection {
    let conn = Connection::open(db_path(app)).expect("failed to open sqlite database");
    conn.pragma_update(None, "foreign_keys", true)
        .expect("failed to enable foreign keys");
    conn.execute_batch(SCHEMA).expect("failed to apply schema");
    conn
}
