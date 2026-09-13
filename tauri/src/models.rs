use serde::{Deserialize, Serialize};

/// A "Bundle" is the top-level container for notes, equivalent to a folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bundle {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// A single note that lives inside a Bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub bundle_id: String,
    pub title: String,
    pub content: String,
    pub pinned: bool,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
    pub sync_version: i64,
    /// Populated on read so the frontend doesn't need a second round trip.
    pub tags: Vec<Tag>,
}

/// A tag, scoped to a single bundle (mirrors how Bundled Notes keeps
/// tags local to each bundle instead of one global list).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub bundle_id: String,
    pub name: String,
    pub color: Option<String>,
}

/// Payload used when creating a note — the caller doesn't know the id,
/// timestamps, etc. yet, those are generated server-side (in Rust).
#[derive(Debug, Clone, Deserialize)]
pub struct NewNote {
    pub bundle_id: String,
    pub title: String,
    pub content: String,
}

/// Payload used when updating an existing note. All fields optional so
/// the frontend can send only what changed.
#[derive(Debug, Clone, Deserialize)]
pub struct NoteUpdate {
    pub title: Option<String>,
    pub content: Option<String>,
    pub pinned: Option<bool>,
    pub position: Option<i64>,
}
