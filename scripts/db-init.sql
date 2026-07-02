-- pgvector for SRD embeddings
CREATE EXTENSION IF NOT EXISTS vector;
-- citext for case-insensitive email/username
CREATE EXTENSION IF NOT EXISTS citext;
-- pg_trgm for hybrid search (BM25-style)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
