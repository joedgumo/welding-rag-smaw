-- Production schema of the v15 assistant (Cloudflare D1), extracted from `wrangler d1 export`.
-- Equivalent to create.sql + migrate_add_page.sql.

CREATE TABLE chats (
  chat_id TEXT PRIMARY KEY,
  reset_at TEXT
);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  telegram_file_id TEXT NOT NULL,
  telegram_file_unique_id TEXT,
  file_name TEXT,
  mime_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  source_name TEXT,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, page INTEGER,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  intent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_documents_chat_id
  ON documents(chat_id);

CREATE INDEX idx_documents_status
  ON documents(status);

CREATE INDEX idx_documents_chat_status
  ON documents(chat_id, status);

CREATE INDEX idx_documents_file_unique
  ON documents(telegram_file_unique_id);

CREATE INDEX idx_documents_updated_at
  ON documents(updated_at);

CREATE INDEX idx_chunks_chat_id
  ON chunks(chat_id);

CREATE INDEX idx_chunks_document_id
  ON chunks(document_id);

CREATE INDEX idx_chunks_chat_document
  ON chunks(chat_id, document_id);

CREATE INDEX idx_chunks_source_name
  ON chunks(source_name);

CREATE INDEX idx_chunks_document_chunk_index
  ON chunks(document_id, chunk_index);

CREATE INDEX idx_messages_chat_id
  ON messages(chat_id);

CREATE INDEX idx_messages_chat_created
  ON messages(chat_id, created_at);

CREATE INDEX idx_messages_role
  ON messages(role);
