import { z } from 'zod';
import { equipmentInput, equipmentUpdate, maintenanceInput } from './equipment.js';

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const object = (properties) => ({ type: 'object', required: Object.keys(properties), properties });
const array = (items) => ({ type: 'array', items });
const json = (schema, example) => ({
  'application/json': { schema, ...(example === undefined ? {} : { example }) },
});
const data = (schema, description = 'Operación correcta.') => ({
  description, content: json(object({ data: schema })),
});
const body = (schema, example) => ({ required: true, content: json(ref(schema), example) });
const integer = { type: 'integer' };
const string = { type: 'string' };
const dateTime = { type: 'string', format: 'date-time' };
const id = { type: 'integer', minimum: 1, maximum: 2147483647 };
const hours = { type: 'integer', minimum: 0, maximum: 1000000 };
const equipmentType = { type: 'string', enum: equipmentInput.shape.type.options };
const idParameter = {
  name: 'id', in: 'path', required: true, schema: id,
  description: 'Identificador numérico devuelto por la API.',
};

function inputSchema(validator) {
  const { $schema, ...schema } = z.toJSONSchema(validator, { io: 'input' });
  if (schema.properties.code) {
    delete schema.properties.code.pattern;
    schema.properties.code.description = 'De 2 a 24 letras, números o guiones. Empieza con una letra o número. La API quita los espacios de los extremos y convierte a mayúsculas.';
  }
  return schema;
}

const errorDescriptions = {
  400: 'Identificador o JSON inválido.',
  404: 'Equipo no encontrado.',
  409: 'Los datos entran en conflicto con el estado del inventario.',
  413: 'El cuerpo supera los 12 kB.',
  422: 'Los datos no cumplen la validación.',
  500: 'Error interno de la API.',
};
const errors = (...statuses) => Object.fromEntries(
  statuses.map((status) => [status, { description: errorDescriptions[status], content: json(ref('Error')) }]),
);
const health = (status) => ({
  description: status === 'ok' ? 'API y PostgreSQL disponibles.' : 'PostgreSQL no está disponible.',
  content: json(object({
    status: { const: status }, database: { const: status }, release: string,
  }), { status, database: status, release: 'local-demo' }),
});

export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'MinaControl API',
    version: '1.0.0',
    description: 'Inventario de equipos mineros y registro de mantenimiento. Usa **Try it out** con datos de demostración. Las operaciones de escritura guardan cambios en la base de datos.',
  },
  servers: [{ url: '/', description: 'Servidor actual' }],
  tags: [
    { name: 'Estado', description: 'Salud de la API y de PostgreSQL.' },
    { name: 'Equipos', description: 'Inventario activo y tipos de equipos.' },
    { name: 'Mantenimiento', description: 'Historial y reinicio del ciclo de servicio.' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Estado'], operationId: 'getHealth', summary: 'Comprobar API y base de datos',
        responses: { 200: health('ok'), 503: health('unavailable') },
      },
    },
    '/api/v1/equipment-types': {
      get: {
        tags: ['Equipos'], operationId: 'listEquipmentTypes', summary: 'Listar tipos e intervalos',
        responses: { 200: data(array(ref('EquipmentType'))), ...errors(500) },
      },
    },
    '/api/v1/equipment': {
      get: {
        tags: ['Equipos'], operationId: 'listEquipment', summary: 'Listar el inventario',
        responses: { 200: data(array(ref('Equipment'))), ...errors(500) },
      },
      post: {
        tags: ['Equipos'], operationId: 'createEquipment', summary: 'Registrar un equipo',
        requestBody: body('CreateEquipment', { code: 'CAM-DEMO', type: 'truck', hours: 499 }),
        responses: {
          201: {
            ...data(ref('Equipment'), 'Equipo creado.'),
            headers: { Location: { description: 'Ruta del equipo creado.', schema: string } },
          },
          ...errors(400, 409, 413, 422, 500),
        },
      },
    },
    '/api/v1/equipment/{id}': {
      parameters: [idParameter],
      get: {
        tags: ['Equipos'], operationId: 'getEquipment', summary: 'Consultar un equipo',
        responses: { 200: data(ref('Equipment')), ...errors(400, 404, 500) },
      },
      patch: {
        tags: ['Equipos'], operationId: 'updateEquipment', summary: 'Actualizar un equipo',
        description: 'Envía al menos un campo. El horómetro puede mantenerse o aumentar.',
        requestBody: body('UpdateEquipment', { hours: 500 }),
        responses: { 200: data(ref('Equipment')), ...errors(400, 404, 409, 413, 422, 500) },
      },
      delete: {
        tags: ['Equipos'], operationId: 'deleteEquipment', summary: 'Retirar un equipo del inventario',
        responses: { 204: { description: 'Equipo retirado. Su historial se conserva en la base.' }, ...errors(400, 404, 500) },
      },
    },
    '/api/v1/equipment/{id}/maintenance': {
      parameters: [idParameter],
      get: {
        tags: ['Mantenimiento'], operationId: 'listMaintenance', summary: 'Consultar el historial de servicios',
        responses: { 200: data(array(ref('Maintenance'))), ...errors(400, 404, 500) },
      },
      post: {
        tags: ['Mantenimiento'], operationId: 'registerMaintenance', summary: 'Registrar un servicio',
        description: 'Guarda la lectura actual en el historial y reinicia el ciclo. Las notas son opcionales. Se admite un solo servicio por lectura del horómetro.',
        requestBody: body('RegisterMaintenance', { notes: 'Inspección y cambio de filtros.' }),
        responses: {
          201: data(object({ equipment: ref('Equipment'), event: ref('Maintenance') }), 'Servicio registrado.'),
          ...errors(400, 404, 409, 413, 422, 500),
        },
      },
    },
  },
  components: {
    schemas: {
      CreateEquipment: inputSchema(equipmentInput),
      UpdateEquipment: { ...inputSchema(equipmentUpdate), minProperties: 1 },
      RegisterMaintenance: inputSchema(maintenanceInput),
      EquipmentType: object({ code: equipmentType, name: string, intervalHours: integer }),
      Equipment: object({
        id, code: string, type: equipmentType, typeName: string, hours, intervalHours: integer,
        lastMaintenanceHours: hours, lastMaintenanceAt: { anyOf: [dateTime, { type: 'null' }] },
        cycleHours: integer,
        remainingHours: { ...integer, description: 'Puede ser negativo si el equipo superó el intervalo.' },
        status: { type: 'string', enum: ['operational', 'upcoming', 'due'] },
      }),
      Maintenance: object({ id, hours, notes: string, performedAt: dateTime }),
      Error: object({
        error: {
          ...object({ code: string, message: string, issues: array(object({ field: string, message: string })) }),
          required: ['code', 'message'],
        },
      }),
    },
  },
};
