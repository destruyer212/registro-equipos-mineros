import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

const origin = process.env.TEST_API_URL || 'http://localhost:4180';
const path = '/api/v1/equipment';

async function request(route, { method = 'GET', body } = {}) {
  const response = await fetch(`${origin}${route}`, {
    method,
    signal: AbortSignal.timeout(10_000),
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: response.status, result: response.status === 204 ? null : await response.json() };
}

test('API y PostgreSQL responden', async () => {
  const { status, result } = await request('/health');
  assert.equal(status, 200);
  assert.equal(result.database, 'ok');
  assert.ok(result.release);
});

test('crear, actualizar, atender y eliminar un equipo', async () => {
  const code = `QA-${randomBytes(5).toString('hex').toUpperCase()}`;
  const payload = { code, type: 'truck', hours: 399 };
  const created = await request(path, { method: 'POST', body: payload });
  assert.equal(created.status, 201);
  const route = `${path}/${created.result.data.id}`;
  try {
    assert.equal(created.result.data.status, 'operational');
    const duplicate = await request(path, { method: 'POST', body: payload });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.result.error.code, 'DUPLICATE_CODE');

    const approaching = await request(route, { method: 'PATCH', body: { hours: 400 } });
    assert.equal(approaching.result.data.status, 'upcoming');
    const due = await request(route, { method: 'PATCH', body: { hours: 500 } });
    assert.equal(due.result.data.status, 'due');
    assert.equal(due.result.data.remainingHours, 0);

    const invalid = await request(route, { method: 'PATCH', body: { hours: 499 } });
    assert.equal(invalid.status, 409);
    assert.equal(invalid.result.error.code, 'HOURS_DECREASE');

    const service = { method: 'POST', body: { notes: 'Prueba de mantenimiento.' } };
    const attempts = await Promise.all([request(`${route}/maintenance`, service), request(`${route}/maintenance`, service)]);
    assert.deepEqual(attempts.map((entry) => entry.status).sort(), [201, 409]);
    const serviced = attempts.find((entry) => entry.status === 201).result.data.equipment;
    assert.equal(serviced.hours, 500);
    assert.equal(serviced.cycleHours, 0);
    assert.equal(serviced.remainingHours, 500);
    assert.equal(serviced.status, 'operational');

    const history = await request(`${route}/maintenance`);
    assert.equal(history.result.data.length, 1);
    assert.equal(history.result.data[0].hours, 500);
    const inventory = await request(path);
    assert.ok(inventory.result.data.some((item) => item.id === serviced.id));
  } finally {
    assert.equal((await request(route, { method: 'DELETE' })).status, 204);
  }
  assert.equal((await request(route)).status, 404);
});
