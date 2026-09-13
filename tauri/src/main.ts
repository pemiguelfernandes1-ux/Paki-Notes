import {
  createBundle,
  listBundles,
  createNote,
  listNotes,
  updateNote,
  searchNotes,
  createTag,
  listTags,
  assignTag,
  removeTag,
} from "./api";
import type { Bundle, Note, Tag } from "./types";
import { renderMarkdown } from "./markdown";

// ----- estado -----

let bundles: Bundle[] = [];
let notesInCurrentBundle: Note[] = [];
let tagsInCurrentBundle: Tag[] = [];
let currentBundleId: string | null = null;
let currentNote: Note | null = null;
let searchActive = false;
let lastSearchResults: Note[] = [];

let saveTimer: number | undefined;
let searchDebounce: number | undefined;

// ----- referências de elementos (preenchidas no DOMContentLoaded) -----

let bundleListEl: HTMLUListElement;
let newBundleBtn: HTMLButtonElement;
let notesTitleEl: HTMLElement;
let newNoteBtn: HTMLButtonElement;
let noteListEl: HTMLUListElement;
let searchInputEl: HTMLInputElement;
let editorEmptyEl: HTMLElement;
let editorEl: HTMLElement;
let titleInputEl: HTMLInputElement;
let contentInputEl: HTMLTextAreaElement;
let previewEl: HTMLElement;
let tagsBarEl: HTMLElement;
let pinBtn: HTMLButtonElement;

const THEME_KEY = "paki-notes:theme";

function applyTheme(theme: string) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
}

// ----- bundles -----

async function loadBundles() {
  bundles = await listBundles(false);
  renderBundleList();
}

function renderBundleList() {
  bundleListEl.innerHTML = "";
  for (const bundle of bundles) {
    const li = document.createElement("li");
    li.className = "list__item" + (bundle.id === currentBundleId ? " list__item--active" : "");
    li.textContent = bundle.name;
    if (bundle.color) li.style.setProperty("--item-color", bundle.color);
    li.addEventListener("click", () => selectBundle(bundle.id));
    bundleListEl.appendChild(li);
  }
}

async function selectBundle(id: string) {
  currentBundleId = id;
  searchActive = false;
  searchInputEl.value = "";
  renderBundleList();
  newNoteBtn.disabled = false;

  const bundle = bundles.find((b) => b.id === id);
  notesTitleEl.textContent = bundle?.name ?? "";

  [notesInCurrentBundle, tagsInCurrentBundle] = await Promise.all([
    listNotes(id),
    listTags(id),
  ]);
  renderNoteList(notesInCurrentBundle);
  closeEditor();
}

async function createBundlePrompt() {
  const name = window.prompt("Nome do novo bundle:");
  if (!name) return;
  const bundle = await createBundle(name);
  bundles.push(bundle);
  bundles.sort((a, b) => a.name.localeCompare(b.name));
  renderBundleList();
  await selectBundle(bundle.id);
}

// ----- notas -----

function renderNoteList(notes: Note[]) {
  noteListEl.innerHTML = "";
  for (const note of notes) {
    const li = document.createElement("li");
    li.className = "list__item" + (note.id === currentNote?.id ? " list__item--active" : "");

    const title = document.createElement("div");
    title.className = "list__item-title";
    title.textContent = (note.pinned ? "📌 " : "") + (note.title || "(sem título)");

    const preview = document.createElement("div");
    preview.className = "list__item-preview";
    preview.textContent = note.content.slice(0, 80).replace(/\n/g, " ");

    li.appendChild(title);
    li.appendChild(preview);
    li.addEventListener("click", () => openNote(note));
    noteListEl.appendChild(li);
  }
}

async function createNotePrompt() {
  if (!currentBundleId) return;
  const note = await createNote(currentBundleId, "", "");
  notesInCurrentBundle.unshift(note);
  renderNoteList(notesInCurrentBundle);
  openNote(note);
}

function openNote(note: Note) {
  currentNote = note;
  renderNoteList(searchActive ? lastSearchResults : notesInCurrentBundle);

  editorEmptyEl.hidden = true;
  editorEl.hidden = false;
  titleInputEl.value = note.title;
  contentInputEl.value = note.content;
  previewEl.innerHTML = renderMarkdown(note.content);
  renderTagsBar();
  updatePinButton();
  titleInputEl.focus();
}

function closeEditor() {
  currentNote = null;
  editorEl.hidden = true;
  editorEmptyEl.hidden = false;
}

function updatePinButton() {
  pinBtn.classList.toggle("is-active", !!currentNote?.pinned);
}

function scheduleSave() {
  if (!currentNote) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveCurrentNote, 400);
}

async function saveCurrentNote() {
  if (!currentNote) return;
  const noteId = currentNote.id;
  const updated = await updateNote(noteId, {
    title: titleInputEl.value,
    content: contentInputEl.value,
  });
  if (!currentNote || currentNote.id !== noteId) return; // usuário trocou de nota enquanto salvava
  currentNote = { ...updated, tags: currentNote.tags };
  const idx = notesInCurrentBundle.findIndex((n) => n.id === noteId);
  if (idx !== -1) notesInCurrentBundle[idx] = currentNote;
  renderNoteList(searchActive ? lastSearchResults : notesInCurrentBundle);
}

async function togglePin() {
  if (!currentNote || !currentBundleId) return;
  const updated = await updateNote(currentNote.id, { pinned: !currentNote.pinned });
  currentNote = { ...currentNote, pinned: updated.pinned };
  updatePinButton();
  notesInCurrentBundle = await listNotes(currentBundleId);
  renderNoteList(notesInCurrentBundle);
}

function wrapSelection(marker: string) {
  const el = contentInputEl;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const before = el.value.slice(0, start);
  const selected = el.value.slice(start, end);
  const after = el.value.slice(end);

  const isLinePrefix = marker.endsWith(" ");
  let newValue: string;
  let cursorStart: number;
  let cursorEnd: number;

  if (isLinePrefix) {
    newValue = before + marker + selected + after;
    cursorStart = start + marker.length;
    cursorEnd = end + marker.length;
  } else {
    newValue = before + marker + selected + marker + after;
    cursorStart = start + marker.length;
    cursorEnd = end + marker.length;
  }

  el.value = newValue;
  el.focus();
  el.setSelectionRange(cursorStart, cursorEnd);
  previewEl.innerHTML = renderMarkdown(el.value);
  scheduleSave();
}

// ----- tags -----

function renderTagsBar() {
  tagsBarEl.innerHTML = "";
  if (!currentNote) return;

  for (const tag of currentNote.tags) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    if (tag.color) chip.style.setProperty("--tag-color", tag.color);
    chip.textContent = tag.name;
    chip.title = "Clique para remover";
    chip.addEventListener("click", async () => {
      await removeTag(currentNote!.id, tag.id);
      currentNote!.tags = currentNote!.tags.filter((t) => t.id !== tag.id);
      renderTagsBar();
    });
    tagsBarEl.appendChild(chip);
  }

  const addBtn = document.createElement("button");
  addBtn.className = "tag-chip tag-chip--add";
  addBtn.textContent = "+ tag";
  addBtn.addEventListener("click", () => openTagPicker(addBtn));
  tagsBarEl.appendChild(addBtn);
}

function openTagPicker(anchor: HTMLElement) {
  document.querySelector(".tag-picker")?.remove();
  if (!currentNote || !currentBundleId) return;

  const picker = document.createElement("div");
  picker.className = "tag-picker";

  const availableTags = tagsInCurrentBundle.filter(
    (t) => !currentNote!.tags.some((nt) => nt.id === t.id),
  );

  for (const tag of availableTags) {
    const item = document.createElement("div");
    item.className = "tag-picker__item";
    item.textContent = tag.name;
    item.addEventListener("click", async () => {
      await assignTag(currentNote!.id, tag.id);
      currentNote!.tags.push(tag);
      renderTagsBar();
      picker.remove();
    });
    picker.appendChild(item);
  }

  const input = document.createElement("input");
  input.placeholder = "Nova tag...";
  input.className = "tag-picker__input";
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      const tag = await createTag(currentBundleId!, input.value.trim());
      tagsInCurrentBundle.push(tag);
      await assignTag(currentNote!.id, tag.id);
      currentNote!.tags.push(tag);
      renderTagsBar();
      picker.remove();
    }
  });
  picker.appendChild(input);

  anchor.after(picker);
  input.focus();

  setTimeout(() => {
    document.addEventListener("click", function onDocClick(ev) {
      if (!picker.contains(ev.target as Node) && ev.target !== anchor) {
        picker.remove();
        document.removeEventListener("click", onDocClick);
      }
    });
  }, 0);
}

// ----- busca -----

function onSearchInput() {
  window.clearTimeout(searchDebounce);
  const query = searchInputEl.value.trim();
  if (!query) {
    searchActive = false;
    renderNoteList(notesInCurrentBundle);
    return;
  }
  searchDebounce = window.setTimeout(async () => {
    searchActive = true;
    lastSearchResults = await searchNotes(query);
    renderNoteList(lastSearchResults);
  }, 250);
}

// ----- bootstrap -----

window.addEventListener("DOMContentLoaded", () => {
  bundleListEl = document.querySelector("#bundle-list")!;
  newBundleBtn = document.querySelector("#new-bundle-btn")!;
  notesTitleEl = document.querySelector("#notes-title")!;
  newNoteBtn = document.querySelector("#new-note-btn")!;
  noteListEl = document.querySelector("#note-list")!;
  searchInputEl = document.querySelector("#search-input")!;
  editorEmptyEl = document.querySelector("#editor-empty")!;
  editorEl = document.querySelector("#editor")!;
  titleInputEl = document.querySelector("#note-title-input")!;
  contentInputEl = document.querySelector("#note-content-input")!;
  previewEl = document.querySelector("#editor-preview")!;
  tagsBarEl = document.querySelector("#editor-tags")!;
  pinBtn = document.querySelector("#pin-btn")!;

  const savedTheme = localStorage.getItem(THEME_KEY) ?? "light";
  applyTheme(savedTheme);
  document.querySelectorAll<HTMLButtonElement>(".theme-dot").forEach((btn) => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.theme!));
  });

  newBundleBtn.addEventListener("click", createBundlePrompt);
  newNoteBtn.addEventListener("click", createNotePrompt);
  searchInputEl.addEventListener("input", onSearchInput);

  titleInputEl.addEventListener("input", scheduleSave);
  contentInputEl.addEventListener("input", () => {
    previewEl.innerHTML = renderMarkdown(contentInputEl.value);
    scheduleSave();
  });

  pinBtn.addEventListener("click", togglePin);

  document.querySelectorAll<HTMLButtonElement>(".editor__toolbar [data-md]").forEach((btn) => {
    btn.addEventListener("click", () => wrapSelection(btn.dataset.md!));
  });

  loadBundles();
});
