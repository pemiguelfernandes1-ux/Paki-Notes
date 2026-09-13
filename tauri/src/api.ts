import { invoke } from "@tauri-apps/api/core";
import type { Bundle, Note, NoteUpdate, Tag } from "./types";

// ---------- Bundles ----------

export function createBundle(name: string, color?: string | null): Promise<Bundle> {
  return invoke("create_bundle", { name, color: color ?? null });
}

export function listBundles(includeArchived = false): Promise<Bundle[]> {
  return invoke("list_bundles", { includeArchived });
}

export function renameBundle(id: string, name: string): Promise<void> {
  return invoke("rename_bundle", { id, name });
}

export function setBundleArchived(id: string, archived: boolean): Promise<void> {
  return invoke("set_bundle_archived", { id, archived });
}

export function deleteBundle(id: string): Promise<void> {
  return invoke("delete_bundle", { id });
}

// ---------- Notes ----------

export function createNote(bundleId: string, title: string, content: string): Promise<Note> {
  return invoke("create_note", { payload: { bundle_id: bundleId, title, content } });
}

export function listNotes(bundleId: string): Promise<Note[]> {
  return invoke("list_notes", { bundleId });
}

export function getNote(id: string): Promise<Note> {
  return invoke("get_note", { id });
}

export function updateNote(id: string, update: NoteUpdate): Promise<Note> {
  return invoke("update_note", { id, update });
}

export function deleteNote(id: string): Promise<void> {
  return invoke("delete_note", { id });
}

export function searchNotes(query: string): Promise<Note[]> {
  return invoke("search_notes", { query });
}

// ---------- Tags ----------

export function createTag(bundleId: string, name: string, color?: string | null): Promise<Tag> {
  return invoke("create_tag", { bundleId, name, color: color ?? null });
}

export function listTags(bundleId: string): Promise<Tag[]> {
  return invoke("list_tags", { bundleId });
}

export function deleteTag(id: string): Promise<void> {
  return invoke("delete_tag", { id });
}

export function assignTag(noteId: string, tagId: string): Promise<void> {
  return invoke("assign_tag", { noteId, tagId });
}

export function removeTag(noteId: string, tagId: string): Promise<void> {
  return invoke("remove_tag", { noteId, tagId });
}
