import assert from 'node:assert/strict';
import { test } from 'node:test';
import { equipmentInput, equipmentUpdate, maintenanceInput, withCycle } from '../src/equipment.js';

test('el ciclo parte del último servicio y cambia de estado en los límites exactos', () => {
  const equipment = { lastMaintenanceHours: 750, intervalHours: 500 };
  for (const [hours, cycleHours, remainingHours, status] of [
    [750, 0, 500, 'operational'],
    [1149, 399, 101, 'operational'],
    [1150, 400, 100, 'upcoming'],
    [1249, 499, 1, 'upcoming'],
    [1250, 500, 0, 'due'],
    [1255, 505, -5, 'due'],
  ]) {
    assert.deepEqual(withCycle({ ...equipment, hours }), {
      ...equipment, hours, cycleHours, remainingHours, status,
    });
  }
});

test('el contrato normaliza códigos y valida lecturas, tipos y notas', () => {
  const item = { code: ' cam-02 ', type: 'truck', hours: 0 };
  assert.deepEqual(equipmentInput.parse(item), { ...item, code: 'CAM-02' });
  for (const hours of [-1, 1.5, 1_000_001, '500']) {
    assert.equal(equipmentInput.safeParse({ ...item, hours }).success, false);
  }
  assert.equal(equipmentInput.safeParse({ ...item, type: 'unknown' }).success, false);
  assert.equal(equipmentUpdate.safeParse({}).success, false);
  assert.deepEqual(equipmentUpdate.parse({ hours: 500 }), { hours: 500 });
  assert.deepEqual(maintenanceInput.parse({}), { notes: '' });
  assert.equal(maintenanceInput.safeParse({ notes: 'a'.repeat(501) }).success, false);
});
