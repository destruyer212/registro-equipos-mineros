import cors from 'cors';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { pool } from './db.js';
import * as equipment from './equipment.js';
import { createOpenapi, runtimeDocumentation } from './openapi.js';

if (!process.env.DATABASE_URL || !process.env.WEB_ORIGIN) {
  throw new Error('Configura DATABASE_URL y WEB_ORIGIN antes de iniciar la API.');
}

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: process.env.WEB_ORIGIN, methods: ['GET', 'POST', 'PATCH', 'DELETE'] }));
app.use((_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '12kb' }));

const specification = createOpenapi(runtimeDocumentation());
const docsDirectory = fileURLToPath(new URL('./docs/', import.meta.url));
app.get('/', (_request, response) => response.redirect('/docs/'));
app.get('/openapi.json', (_request, response) => response.json(specification));
app.use('/docs', express.static(docsDirectory), swaggerUi.serveFiles());

app.get('/health', async (_request, response) => {
  const release = process.env.RELEASE_ID || process.env.RENDER_GIT_COMMIT || 'dev';
  try {
    await pool.query('SELECT 1 FROM equipment_types LIMIT 1');
    response.json({ status: 'ok', database: 'ok', release });
  } catch (error) {
    console.error('Verificación de PostgreSQL:', error.message);
    response.status(503).json({ status: 'unavailable', database: 'unavailable', release });
  }
});

const api = express.Router();
api.param('id', (request, _response, next, value) => {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isInteger(id) || id > 2_147_483_647) {
    return next(new equipment.ApiError(400, 'INVALID_ID', 'El identificador debe ser un entero positivo.'));
  }
  request.equipmentId = id;
  next();
});

api.get('/equipment-types', async (_request, response) => response.json({ data: await equipment.types() }));
api.get('/equipment', async (_request, response) => response.json({ data: await equipment.list() }));
api.post('/equipment', async (request, response) => {
  const data = await equipment.create(equipment.equipmentInput.parse(request.body));
  response.status(201).location(`/api/v1/equipment/${data.id}`).json({ data });
});
api.get('/equipment/:id', async (request, response) => {
  const data = await equipment.get(request.equipmentId);
  response.json({ data });
});
api.patch('/equipment/:id', async (request, response) => {
  const data = await equipment.update(request.equipmentId, equipment.equipmentUpdate.parse(request.body));
  response.json({ data });
});
api.delete('/equipment/:id', async (request, response) => {
  await equipment.remove(request.equipmentId);
  response.status(204).end();
});
api.get('/equipment/:id/maintenance', async (request, response) => {
  response.json({ data: await equipment.history(request.equipmentId) });
});
api.post('/equipment/:id/maintenance', async (request, response) => {
  const data = await equipment.maintain(request.equipmentId, equipment.maintenanceInput.parse(request.body));
  response.status(201).json({ data });
});
app.use('/api/v1', api);

app.use((_request, _response, next) => {
  next(new equipment.ApiError(404, 'NOT_FOUND', 'La ruta solicitada no existe.'));
});
app.use((error, _request, response, _next) => {
  if (error instanceof equipment.ApiError) {
    return response.status(error.status).json({ error: { code: error.code, message: error.message } });
  }
  if (error instanceof ZodError) {
    const issues = error.issues.map(({ path, message }) => ({ field: path.join('.'), message }));
    return response.status(422).json({ error: { code: 'VALIDATION', message: 'Revisa los datos ingresados.', issues } });
  }
  if (error.code === '23505' && error.constraint === 'equipment_active_code') {
    return response.status(409).json({ error: { code: 'DUPLICATE_CODE', message: 'Ya existe un equipo con ese código.' } });
  }
  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: { code: 'INVALID_JSON', message: 'El cuerpo de la solicitud debe ser JSON válido.' } });
  }
  if (error.type === 'entity.too.large') {
    return response.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'La solicitud supera el tamaño permitido.' } });
  }
  console.error(error);
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'La API no pudo completar la operación.' } });
});

const server = app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('MinaControl API lista.'));
function shutdown() {
  server.close(async () => {
    await pool.end();
  });
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
