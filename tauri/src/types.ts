// Espelham exatamente o JSON que o backend Rust serializa (serde não
// converte para camelCase, então os nomes ficam em snake_case mesmo).

export interface Bundle {
  id: string;
  name: string;
  color: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  bundle_id: string;
  name: string;
  color: string | null;
}

export interface Note {
  id: string;
  bundle_id: string;
  title: string;
  content: string;
  pinned: boolean;
  position: number;
  created_at: string;
  updated_at: string;
  sync_version: number;
  tags: Tag[];
}

export interface NewNote {
  bundle_id: string;
  title: string;
  content: string;
}

export interface NoteUpdate {
  title?: string;
  content?: string;
  pinned?: boolean;
  position?: number;
}
