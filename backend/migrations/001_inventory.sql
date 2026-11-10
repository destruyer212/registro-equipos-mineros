CREATE TABLE equipment_types (
    code text PRIMARY KEY,
    name text NOT NULL,
    interval_hours integer NOT NULL CHECK (interval_hours > 0)
);

INSERT INTO equipment_types (code, name, interval_hours) VALUES
    ('truck', 'Camión', 500),
    ('excavator', 'Excavadora', 250),
    ('drill', 'Perforadora', 300);

CREATE TABLE equipment (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code text NOT NULL,
    type_code text NOT NULL REFERENCES equipment_types (code),
    hours integer NOT NULL CHECK (hours BETWEEN 0 AND 1000000),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE UNIQUE INDEX equipment_active_code ON equipment (code) WHERE deleted_at IS NULL;

CREATE TABLE maintenance (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    equipment_id integer NOT NULL REFERENCES equipment (id),
    hours integer NOT NULL CHECK (hours BETWEEN 0 AND 1000000),
    notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 500),
    performed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX maintenance_equipment_history ON maintenance (equipment_id, id DESC);
