// Schema definitions for the command center database
// Using JSON file storage instead of SQLite, but keeping type definitions
// for documentation and potential future migration

export interface EntityRow {
  id: string;
  type: string;
  name: string;
  path: string;
  description: string | null;
  last_modified: string | null;
  tags: string;
  health: string;
  data: string;
  scanned_at: string;
}

export interface RelationshipRow {
  id: number;
  source_id: string;
  source_type: string;
  target_id: string;
  target_type: string;
  relation: string;
}

export interface MarkdownBackupRow {
  id: number;
  file_path: string;
  content: string;
  created_at: string;
  reason: string;
}

export interface DiscoveryCacheRow {
  id: number;
  query: string;
  results: string;
  cached_at: string;
}
