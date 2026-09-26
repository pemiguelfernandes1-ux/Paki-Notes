import "./fonts";
import {
  createBundle,
  listBundles,
  createNote,
  listNotes,
  updateNote,
  reorderNotes,
  searchNotes,
  createTag,
  listTags,
  assignTag,
  removeTag,
} from "./api";
import type { Bundle, BundleKind, Note, Tag } from "./types";
import { LiveMarkdownEditor } from "./editor";

// ----- estado -----

let bundles: Bundle[] = [];
let notesInCurrentBundle: Note[] = [];
let tagsInCurrentBundle: Tag[] = [];
let currentBundleId: string | null = null;
let currentNote: Note | null = null;
let searchActive = false;
let lastSearchResults: Note[] = [];
let sortMode: "manual" | "newest" | "oldest" = "manual";
let draggedNoteId: string | null = null;
let selectedKind: BundleKind = "list";

let liveEditor: LiveMarkdownEditor | null = null;
let saveTimer: number | undefined;
let searchDebounce: number | undefined;

// ----- referências de elementos (preenchidas no DOMContentLoaded) -----

let bundleListEl: HTMLUListElement;
let newBundleBtn: HTMLButtonElement;
let notesTitleEl: HTMLElement;
let newNoteBtn: HTMLButtonElement;
let noteListEl: HTMLUListElement;
let searchInputEl: HTMLInputElement;
let sortButtons: NodeListOf<HTMLButtonElement>;

let homeEmptyEl: HTMLElement;
let homeCreateBundleBtn: HTMLButtonElement;
let editorEmptyEl: HTMLElement;
let editorEl: HTMLElement;
let titleInputEl: HTMLInputElement;
let cmHostEl: HTMLElement;
let tagsBarEl: HTMLElement;
let pinBtn: HTMLButtonElement;

let bundleModalEl: HTMLElement;
let bundleNameInputEl: HTMLInputElement;
let bundleModalCancelBtn: HTMLButtonElement;
let bundleModalCreateBtn: HTMLButtonElement;
let kindCards: NodeListOf<HTMLButtonElement>;

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
  homeEmptyEl.hidden = true;

  const bundle = bundles.find((b) => b.id === id);
  notesTitleEl.textContent = bundle?.name ?? "";

  if (bundle?.kind === "board") {
    newNoteBtn.disabled = true;
    noteListEl.classList.remove("note-list--grid");
    noteListEl.innerHTML = '<li class="list__empty-hint">Quadros (Kanban) chega na próxima etapa 🙂</li>';
    notesInCurrentBundle = [];
    closeEditor();
    return;
  }

  newNoteBtn.disabled = false;
  [notesInCurrentBundle, tagsInCurrentBundle] = await Promise.all([
    listNotes(id),
    listTags(id),
  ]);
  setSortMode("manual");
  closeEditor();
}

// ----- modal: criar bundle -----

function openBundleModal() {
  bundleNameInputEl.value = "";
  selectedKind = "list";
  updateKindCardsUI();
  bundleModalEl.hidden = false;
  bundleNameInputEl.focus();
}

function closeBundleModal() {
  bundleModalEl.hidden = true;
}

function updateKindCardsUI() {
  kindCards.forEach((card) => {
    card.classList.toggle("is-selected", card.dataset.kind === selectedKind);
  });
}

async function confirmCreateBundle() {
  const name = bundleNameInputEl.value.trim();
  if (!name) {
    bundleNameInputEl.focus();
    return;
  }
  const bundle = await createBundle(name, selectedKind);
  bundles.push(bundle);
  bundles.sort((a, b) => a.name.localeCompare(b.name));
  renderBundleList();
  closeBundleModal();
  await selectBundle(bundle.id);
}

// ----- notas -----

function applySortMode(notes: Note[]): Note[] {
  if (sortMode === "manual") return notes;
  const sorted = [...notes];
  sorted.sort((a, b) => {
    const cmp = a.created_at.localeCompare(b.created_at);
    return sortMode === "newest" ? -cmp : cmp;
  });
  return sorted;
}

function getDisplayedNotes(): Note[] {
  const base = searchActive ? lastSearchResults : notesInCurrentBundle;
  return applySortMode(base);
}

function setSortMode(mode: "manual" | "newest" | "oldest") {
  sortMode = mode;
  sortButtons.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.sort === mode));
  renderNoteList(getDisplayedNotes());
}

function renderNoteList(notes: Note[]) {
  const bundle = bundles.find((b) => b.id === currentBundleId);
  noteListEl.classList.toggle("note-list--grid", !searchActive && bundle?.kind === "grid");
  noteListEl.innerHTML = "";

  const dragEnabled = sortMode === "manual" && !searchActive;

  for (const note of notes) {
    const li = document.createElement("li");
    li.className = "list__item" + (note.id === currentNote?.id ? " list__item--active" : "");
    li.draggable = dragEnabled;

    const title = document.createElement("div");
    title.className = "list__item-title";
    title.textContent = (note.pinned ? "📌 " : "") + (note.title || "(sem título)");

    const preview = document.createElement("div");
    preview.className = "list__item-preview";
    preview.textContent = note.content.slice(0, 120).replace(/\n/g, " ");

    li.appendChild(title);
    li.appendChild(preview);
    li.addEventListener("click", () => openNote(note));

    if (dragEnabled) {
      li.addEventListener("dragstart", () => {
        draggedNoteId = note.id;
        li.classList.add("is-dragging");
      });
      li.addEventListener("dragend", () => {
        draggedNoteId = null;
        li.classList.remove("is-dragging");
      });
      li.addEventListener("dragover", (e) => {
        if (draggedNoteId && draggedNoteId !== note.id) e.preventDefault();
      });
      li.addEventListener("drop", async (e) => {
        e.preventDefault();
        if (!draggedNoteId || draggedNoteId === note.id || !currentBundleId) return;
        const list = notesInCurrentBundle;
        const fromIdx = list.findIndex((n) => n.id === draggedNoteId);
        const toIdx = list.findIndex((n) => n.id === note.id);
        if (fromIdx === -1 || toIdx === -1) return;
        const [moved] = list.splice(fromIdx, 1);
        list.splice(toIdx, 0, moved);
        renderNoteList(getDisplayedNotes());
        await reorderNotes(currentBundleId, list.map((n) => n.id));
      });
    }

    noteListEl.appendChild(li);
  }
}

async function createNotePrompt() {
  if (!currentBundleId) return;
  const note = await createNote(currentBundleId, "", "");
  notesInCurrentBundle.unshift(note);
  renderNoteList(getDisplayedNotes());
  openNote(note);
}

function openNote(note: Note) {
  currentNote = note;
  renderNoteList(getDisplayedNotes());

  homeEmptyEl.hidden = true;
  editorEmptyEl.hidden = true;
  editorEl.hidden = false;
  titleInputEl.value = note.title;

  if (!liveEditor) {
    liveEditor = new LiveMarkdownEditor({
      parent: cmHostEl,
      doc: note.content,
      onChange: () => scheduleSave(),
    });
  } else {
    liveEditor.setContent(note.content);
  }

  renderTagsBar();
  updatePinButton();
  titleInputEl.focus();
}

function closeEditor() {
  currentNote = null;
  editorEl.hidden = true;
  homeEmptyEl.hidden = true;
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
  if (!currentNote || !liveEditor) return;
  const noteId = currentNote.id;
  const updated = await updateNote(noteId, {
    title: titleInputEl.value,
    content: liveEditor.getContent(),
  });
  if (!currentNote || currentNote.id !== noteId) return; // usuário trocou de nota enquanto salvava
  currentNote = { ...updated, tags: currentNote.tags };
  const idx = notesInCurrentBundle.findIndex((n) => n.id === noteId);
  if (idx !== -1) notesInCurrentBundle[idx] = currentNote;
  renderNoteList(getDisplayedNotes());
}

async function togglePin() {
  if (!currentNote || !currentBundleId) return;
  const updated = await updateNote(currentNote.id, { pinned: !currentNote.pinned });
  currentNote = { ...currentNote, pinned: updated.pinned };
  updatePinButton();
  notesInCurrentBundle = await listNotes(currentBundleId);
  renderNoteList(getDisplayedNotes());
}

function applyMarkdownMarker(marker: string) {
  if (!liveEditor) return;
  liveEditor.wrapSelection(marker);
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
    renderNoteList(getDisplayedNotes());
    return;
  }
  searchDebounce = window.setTimeout(async () => {
    searchActive = true;
    lastSearchResults = await searchNotes(query);
    renderNoteList(getDisplayedNotes());
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
  sortButtons = document.querySelectorAll("#sort-toggle .sort-btn");

  homeEmptyEl = document.querySelector("#home-empty")!;
  homeCreateBundleBtn = document.querySelector("#home-create-bundle-btn")!;
  editorEmptyEl = document.querySelector("#editor-empty")!;
  editorEl = document.querySelector("#editor")!;
  titleInputEl = document.querySelector("#note-title-input")!;
  cmHostEl = document.querySelector("#cm-editor-host")!;
  tagsBarEl = document.querySelector("#editor-tags")!;
  pinBtn = document.querySelector("#pin-btn")!;

  bundleModalEl = document.querySelector("#bundle-modal")!;
  bundleNameInputEl = document.querySelector("#bundle-name-input")!;
  bundleModalCancelBtn = document.querySelector("#bundle-modal-cancel")!;
  bundleModalCreateBtn = document.querySelector("#bundle-modal-create")!;
  kindCards = document.querySelectorAll(".kind-card");

  newBundleBtn.addEventListener("click", openBundleModal);
  homeCreateBundleBtn.addEventListener("click", openBundleModal);
  bundleModalCancelBtn.addEventListener("click", closeBundleModal);
  bundleModalEl.addEventListener("click", (e) => {
    if (e.target === bundleModalEl) closeBundleModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !bundleModalEl.hidden) closeBundleModal();
  });
  bundleNameInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmCreateBundle();
  });
  bundleModalCreateBtn.addEventListener("click", confirmCreateBundle);
  kindCards.forEach((card) => {
    card.addEventListener("click", () => {
      if (card.dataset.disabled === "true") return;
      selectedKind = card.dataset.kind as BundleKind;
      updateKindCardsUI();
    });
  });

  newNoteBtn.addEventListener("click", createNotePrompt);
  searchInputEl.addEventListener("input", onSearchInput);
  sortButtons.forEach((btn) => {
    btn.addEventListener("click", () => setSortMode(btn.dataset.sort as "manual" | "newest" | "oldest"));
  });

  titleInputEl.addEventListener("input", scheduleSave);
  pinBtn.addEventListener("click", togglePin);

  document.querySelectorAll<HTMLButtonElement>(".editor__toolbar [data-md]").forEach((btn) => {
    btn.addEventListener("click", () => applyMarkdownMarker(btn.dataset.md!));
  });

  loadBundles();
});
