use crate::db::Db;
use crate::models::{Bundle, NewNote, Note, NoteUpdate, Tag};
use rusqlite::{params, Connection};
use tauri::State;
use uuid::Uuid;

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn tags_for_note(conn: &Connection, note_id: &str) -> Vec<Tag> {
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.bundle_id, t.name, t.color
             FROM tags t
             JOIN note_tags nt ON nt.tag_id = t.id
             WHERE nt.note_id = ?1
             ORDER BY t.name",
        )
        .expect("prepare tags_for_note failed");

    stmt.query_map(params![note_id], |row| {
        Ok(Tag {
            id: row.get(0)?,
            bundle_id: row.get(1)?,
            name: row.get(2)?,
            color: row.get(3)?,
        })
    })
    .expect("query tags_for_note failed")
    .filter_map(Result::ok)
    .collect()
}

fn row_to_note(conn: &Connection, row: &rusqlite::Row) -> rusqlite::Result<Note> {
    let id: String = row.get(0)?;
    let tags = tags_for_note(conn, &id);
    Ok(Note {
        id,
        bundle_id: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        pinned: row.get::<_, i64>(4)? != 0,
        position: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        sync_version: row.get(8)?,
        tags,
    })
}

const NOTE_COLUMNS: &str =
    "id, bundle_id, title, content, pinned, position, created_at, updated_at, sync_version";

// ---------- Bundles ----------

#[tauri::command]
pub fn create_bundle(db: State<Db>, name: String, color: Option<String>) -> Result<Bundle, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO bundles (id, name, color, archived, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?4)",
        params![id, name, color, ts],
    )
    .map_err(|e| e.to_string())?;

    Ok(Bundle {
        id,
        name,
        color,
        archived: false,
        created_at: ts.clone(),
        updated_at: ts,
    })
}

#[tauri::command]
pub fn list_bundles(db: State<Db>, include_archived: bool) -> Result<Vec<Bundle>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = if include_archived {
        "SELECT id, name, color, archived, created_at, updated_at FROM bundles ORDER BY name"
    } else {
        "SELECT id, name, color, archived, created_at, updated_at FROM bundles WHERE archived = 0 ORDER BY name"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let bundles = stmt
        .query_map([], |row| {
            Ok(Bundle {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                archived: row.get::<_, i64>(3)? != 0,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(bundles)
}

#[tauri::command]
pub fn rename_bundle(db: State<Db>, id: String, name: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE bundles SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name, now(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_bundle_archived(db: State<Db>, id: String, archived: bool) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE bundles SET archived = ?1, updated_at = ?2 WHERE id = ?3",
        params![archived as i64, now(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_bundle(db: State<Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM bundles WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Notes ----------

#[tauri::command]
pub fn create_note(db: State<Db>, payload: NewNote) -> Result<Note, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = new_id();
    let ts = now();

    let next_position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM notes WHERE bundle_id = ?1",
            params![payload.bundle_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO notes (id, bundle_id, title, content, pinned, position, created_at, updated_at, sync_version)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?6, 0)",
        params![id, payload.bundle_id, payload.title, payload.content, next_position, ts],
    )
    .map_err(|e| e.to_string())?;

    Ok(Note {
        id,
        bundle_id: payload.bundle_id,
        title: payload.title,
        content: payload.content,
        pinned: false,
        position: next_position,
        created_at: ts.clone(),
        updated_at: ts,
        sync_version: 0,
        tags: vec![],
    })
}

#[tauri::command]
pub fn list_notes(db: State<Db>, bundle_id: String) -> Result<Vec<Note>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = format!(
        "SELECT {NOTE_COLUMNS} FROM notes WHERE bundle_id = ?1 ORDER BY pinned DESC, position ASC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let notes = stmt
        .query_map(params![bundle_id], |row| row_to_note(&conn, row))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(notes)
}

#[tauri::command]
pub fn get_note(db: State<Db>, id: String) -> Result<Note, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let sql = format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?1");
    conn.query_row(&sql, params![id], |row| row_to_note(&conn, row))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_note(db: State<Db>, id: String, update: NoteUpdate) -> Result<Note, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let ts = now();

    if let Some(title) = &update.title {
        conn.execute(
            "UPDATE notes SET title = ?1, updated_at = ?2, sync_version = sync_version + 1 WHERE id = ?3",
            params![title, ts, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(content) = &update.content {
        conn.execute(
            "UPDATE notes SET content = ?1, updated_at = ?2, sync_version = sync_version + 1 WHERE id = ?3",
            params![content, ts, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(pinned) = update.pinned {
        conn.execute(
            "UPDATE notes SET pinned = ?1, updated_at = ?2 WHERE id = ?3",
            params![pinned as i64, ts, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(position) = update.position {
        conn.execute(
            "UPDATE notes SET position = ?1, updated_at = ?2 WHERE id = ?3",
            params![position, ts, id],
        )
        .map_err(|e| e.to_string())?;
    }

    let sql = format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?1");
    conn.query_row(&sql, params![id], |row| row_to_note(&conn, row))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_note(db: State<Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn search_notes(db: State<Db>, query: String) -> Result<Vec<Note>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let pattern = format!("%{}%", query);
    let sql = format!(
        "SELECT {NOTE_COLUMNS} FROM notes
         WHERE title LIKE ?1 OR content LIKE ?1
         ORDER BY updated_at DESC
         LIMIT 100"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let notes = stmt
        .query_map(params![pattern], |row| row_to_note(&conn, row))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(notes)
}

// ---------- Tags ----------

#[tauri::command]
pub fn create_tag(
    db: State<Db>,
    bundle_id: String,
    name: String,
    color: Option<String>,
) -> Result<Tag, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = new_id();
    conn.execute(
        "INSERT INTO tags (id, bundle_id, name, color) VALUES (?1, ?2, ?3, ?4)",
        params![id, bundle_id, name, color],
    )
    .map_err(|e| e.to_string())?;
    Ok(Tag { id, bundle_id, name, color })
}

#[tauri::command]
pub fn list_tags(db: State<Db>, bundle_id: String) -> Result<Vec<Tag>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, bundle_id, name, color FROM tags WHERE bundle_id = ?1 ORDER BY name")
        .map_err(|e| e.to_string())?;
    let tags = stmt
        .query_map(params![bundle_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                bundle_id: row.get(1)?,
                name: row.get(2)?,
                color: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(tags)
}

#[tauri::command]
pub fn delete_tag(db: State<Db>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tags WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn assign_tag(db: State<Db>, note_id: String, tag_id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?1, ?2)",
        params![note_id, tag_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn remove_tag(db: State<Db>, note_id: String, tag_id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM note_tags WHERE note_id = ?1 AND tag_id = ?2",
        params![note_id, tag_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
