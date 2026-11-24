CREATE TABLE pass_reasons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) BETWEEN 2 AND 60)
) STRICT;

INSERT INTO pass_reasons (id, name) VALUES ('compra', 'Compra'), ('cesion', 'Cesión');

ALTER TABLE passes ADD COLUMN reason_id TEXT REFERENCES pass_reasons(id);
CREATE INDEX passes_reason ON passes(reason_id);
