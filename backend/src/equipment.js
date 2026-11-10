import { z } from 'zod';
import { pool, transaction } from './db.js';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const equipmentInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/, 'Usa de 2 a 24 letras, números o guiones.'),
  type: z.enum(['truck', 'excavator', 'drill'], { error: 'Selecciona un tipo de equipo.' }),
  hours: z.number().int().min(0).max(1_000_000, 'El máximo es 1 000 000 de horas.'),
}).strict();

export const equipmentUpdate = equipmentInput.partial().refine(
  (input) => Object.keys(input).length > 0,
  'Envía al menos un campo para actualizar.',
);

export const maintenanceInput = z.object({
  notes: z.string().trim().max(500).default(''),
}).strict();

const inventory = `
  SELECT e.id, e.code, e.type_code AS type, t.name AS "typeName", e.hours,
         t.interval_hours AS "intervalHours",
         COALESCE(m.hours, 0) AS "lastMaintenanceHours",
         m.performed_at AS "lastMaintenanceAt"
  FROM equipment e
  JOIN equipment_types t ON t.code = e.type_code
  LEFT JOIN LATERAL (
    SELECT hours, performed_at FROM maintenance WHERE equipment_id = e.id ORDER BY id DESC LIMIT 1
  ) m ON true
  WHERE e.deleted_at IS NULL
`;

export function withCycle(equipment) {
  const cycleHours = equipment.hours - equipment.lastMaintenanceHours;
  const remainingHours = equipment.intervalHours - cycleHours;
  const status = remainingHours <= 0 ? 'due'
    : cycleHours * 5 >= equipment.intervalHours * 4 ? 'upcoming' : 'operational';

  return { ...equipment, cycleHours, remainingHours, status };
}

async function find(client, id) {
  const { rows: [row] } = await client.query(`${inventory} AND e.id = $1`, [id]);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'El equipo no está en el inventario.');
  return withCycle(row);
}

async function lock(client, id) {
  const { rows: [row] } = await client.query(
    'SELECT hours FROM equipment WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
    [id],
  );
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'El equipo no está en el inventario.');
  return row;
}

export async function types() {
  const { rows } = await pool.query(
    'SELECT code, name, interval_hours AS "intervalHours" FROM equipment_types ORDER BY name',
  );
  return rows;
}

export async function list() {
  const { rows } = await pool.query(`${inventory} ORDER BY e.code`);
  return rows.map(withCycle);
}

export function get(id) {
  return find(pool, id);
}

export function create(input) {
  return transaction(async (client) => {
    const { rows: [{ id }] } = await client.query(
      'INSERT INTO equipment (code, type_code, hours) VALUES ($1, $2, $3) RETURNING id',
      [input.code, input.type, input.hours],
    );
    return find(client, id);
  });
}

export function update(id, input) {
  return transaction(async (client) => {
    const current = await lock(client, id);
    if (input.hours !== undefined && input.hours < current.hours) {
      throw new ApiError(409, 'HOURS_DECREASE', 'El horómetro debe ser igual o mayor a la lectura actual.');
    }
    await client.query(
      `UPDATE equipment SET code = COALESCE($2, code), type_code = COALESCE($3, type_code),
        hours = COALESCE($4, hours), updated_at = now() WHERE id = $1`,
      [id, input.code, input.type, input.hours],
    );
    return find(client, id);
  });
}

export async function remove(id) {
  const { rowCount } = await pool.query(
    'UPDATE equipment SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  if (!rowCount) throw new ApiError(404, 'NOT_FOUND', 'El equipo no está en el inventario.');
}

export function history(id) {
  return transaction(async (client) => {
    const { rows: [equipment] } = await client.query(
      'SELECT id FROM equipment WHERE id = $1 AND deleted_at IS NULL FOR SHARE',
      [id],
    );
    if (!equipment) throw new ApiError(404, 'NOT_FOUND', 'El equipo no está en el inventario.');
    const { rows } = await client.query(
      'SELECT id, hours, notes, performed_at AS "performedAt" FROM maintenance WHERE equipment_id = $1 ORDER BY id DESC',
      [id],
    );
    return rows;
  });
}

export function maintain(id, { notes }) {
  return transaction(async (client) => {
    const { hours } = await lock(client, id);
    const { rows: [last] } = await client.query(
      'SELECT hours FROM maintenance WHERE equipment_id = $1 ORDER BY id DESC LIMIT 1',
      [id],
    );
    if (last?.hours === hours) {
      throw new ApiError(409, 'MAINTENANCE_EXISTS', 'Ya registraste un mantenimiento con esta lectura.');
    }
    const { rows: [event] } = await client.query(
      'INSERT INTO maintenance (equipment_id, hours, notes) VALUES ($1, $2, $3) RETURNING id, hours, notes, performed_at AS "performedAt"',
      [id, hours, notes],
    );
    return { equipment: await find(client, id), event };
  });
}
