CREATE TABLE holders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
) STRICT;

CREATE TABLE lots (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  depot TEXT NOT NULL
) STRICT;

CREATE TABLE opening_balances (
  holder_id TEXT NOT NULL REFERENCES holders(id),
  lot_id TEXT NOT NULL REFERENCES lots(id),
  kilos INTEGER NOT NULL CHECK (kilos >= 0),
  PRIMARY KEY (holder_id, lot_id)
) STRICT;

CREATE TABLE passes (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  request_id TEXT NOT NULL,
  lot_id TEXT NOT NULL REFERENCES lots(id),
  origin_id TEXT NOT NULL REFERENCES holders(id),
  destination_id TEXT NOT NULL REFERENCES holders(id),
  kilos INTEGER NOT NULL CHECK (kilos > 0),
  confirmed_at TEXT NOT NULL,
  UNIQUE (workspace, request_id),
  CHECK (origin_id <> destination_id)
) STRICT;

CREATE INDEX passes_workspace_time ON passes(workspace, confirmed_at DESC);

CREATE TABLE movements (
  pass_id TEXT NOT NULL REFERENCES passes(id),
  holder_id TEXT NOT NULL REFERENCES holders(id),
  direction INTEGER NOT NULL CHECK (direction IN (-1, 1)),
  kilos INTEGER NOT NULL CHECK (kilos > 0),
  PRIMARY KEY (pass_id, direction)
) STRICT;

CREATE INDEX movements_holder ON movements(holder_id, pass_id);

CREATE TRIGGER validate_stock_before_pass
BEFORE INSERT ON passes
WHEN NEW.kilos > COALESCE(
  (SELECT kilos FROM opening_balances WHERE lot_id = NEW.lot_id AND holder_id = NEW.origin_id), 0
) + COALESCE(
  (SELECT SUM(m.kilos * m.direction)
   FROM movements m JOIN passes p ON p.id = m.pass_id
   WHERE p.workspace = NEW.workspace AND p.lot_id = NEW.lot_id AND m.holder_id = NEW.origin_id), 0
)
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK');
END;

CREATE TRIGGER create_movements_after_pass
AFTER INSERT ON passes
BEGIN
  INSERT INTO movements (pass_id, holder_id, direction, kilos) VALUES
    (NEW.id, NEW.origin_id, -1, NEW.kilos),
    (NEW.id, NEW.destination_id, 1, NEW.kilos);
END;

INSERT INTO holders (id, name) VALUES ('alfa', 'Acero Alfa'), ('delta', 'Metal Delta'), ('sur', 'Suministros Sur');
INSERT INTO lots (id, description, depot) VALUES
  ('L-0101', 'Perfil laminado W200', 'Depósito Norte'),
  ('L-0102', 'Chapa laminada 6 mm', 'Depósito Norte'),
  ('L-0201', 'Barra redonda 20 mm', 'Depósito Sur');
INSERT INTO opening_balances VALUES
  ('alfa', 'L-0101', 800), ('delta', 'L-0101', 100),
  ('alfa', 'L-0102', 1250), ('sur', 'L-0102', 350),
  ('delta', 'L-0201', 600), ('sur', 'L-0201', 230);
