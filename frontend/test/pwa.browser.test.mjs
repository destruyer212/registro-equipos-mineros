import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, devices, webkit } from 'playwright';

const origin = process.env.TEST_WEB_URL || 'http://localhost:4173';
const target = process.env.TEST_PWA_TARGET;
const scenarios = [
  { name: 'Android', engine: chromium, profile: 'Pixel 7' },
  { name: 'iPhone', engine: webkit, profile: 'iPhone 13' },
];

for (const { name, engine, profile } of scenarios.filter((entry) => !target || entry.name === target)) {
  test(`PWA en ${name}: navegación, recarga sin red y reconexión`, { timeout: 45_000 }, async (t) => {
    const browser = await engine.launch();
    t.after(() => browser.close());
    const context = await browser.newContext(devices[profile]);
    if (name === 'iPhone') {
      await context.addInitScript(() => {
        Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
        Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
      });
    }
    const page = await context.newPage();
    page.setDefaultTimeout(9000);
    await page.goto(`${origin}/?vista=mantenimiento`);
    await page.getByRole('heading', { name: 'Mantenimiento', exact: true }).waitFor();
    const cachedEquipment = page.getByRole('button', { name: /CAM-101 Camión/ });
    await cachedEquipment.waitFor();
    assert.ok(await page.getByRole('list', { name: 'Equipos del inventario' }).isVisible());
    assert.ok(await page.getByRole('button', { name: 'Instalar app' }).isVisible());
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    if (name === 'iPhone') {
      await page.getByRole('button', { name: 'Instalar app' }).click();
      const install = page.getByRole('dialog', { name: 'Instalar MinaControl' });
      await install.getByText('Lista para consultar sin conexión').waitFor();
      assert.ok(await install.getByText(/Safari y toca Compartir/).isVisible());
      await install.getByRole('button', { name: 'Cerrar' }).click();
    }

    await page.getByRole('button', { name: 'Flota de equipos', exact: true }).click();
    await page.waitForURL('**/?vista=flota');
    await page.goBack();
    await page.getByRole('heading', { name: 'Mantenimiento', exact: true }).waitFor();
    await page.setViewportSize({ width: 320, height: 680 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);

    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Inventario sin conexión', { exact: true }).waitFor();
    assert.ok(await cachedEquipment.isVisible());
    assert.equal(await page.getByRole('button', { name: 'Nuevo equipo' }).isEnabled(), false);
    await cachedEquipment.click();
    const details = page.getByRole('dialog', { name: 'CAM-101' });
    await details.getByText(/El historial y las acciones de mantenimiento requieren conexión/).waitFor();
    assert.equal(await details.getByRole('button', { name: 'Registrar servicio' }).count(), 0);
    await details.getByRole('button', { name: 'Cerrar' }).click();

    await context.setOffline(false);
    await page.getByText('API conectada', { exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Nuevo equipo' }).isEnabled());
  });
}
