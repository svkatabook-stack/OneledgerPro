import { test, expect } from '@playwright/test';

async function login(page, role = 'Owner') {
  await page.goto('/');
  await page.getByRole('button', { name: role, exact: false }).click();
  await page.getByPlaceholder('Enter Passcode...').fill(`${role.toLowerCase()}-local`);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.locator('.app-header')).toContainText('OneLedger Pro');
}

for (const role of ['Owner', 'Staff', 'View']) {
  test(`${role} local sign-in and reload`, async ({ page }) => {
    await login(page, role);
    await page.reload();
    await expect(page.locator('.app-header')).toContainText('LOCAL DEMO');
  });
}

test('local customer, category balances, photo, reload, export and navigation', async ({ page }) => {
  const external = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1') {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await login(page);
  await page.goto('/customers');
  await page.getByPlaceholder('10-digit number', { exact: true }).fill('9000000123');
  await page.getByPlaceholder('Full name', { exact: true }).fill('Local Smoke Customer');
  await page.getByRole('button', { name: 'Save Customer' }).click();
  await expect(page.getByText('1 customer registered')).toBeVisible();

  // Known independent expected balances exercise all eight accounting buckets.
  const entries = [
    ['Retail', 'Cash', '1200.50', 'retailCash', false],
    ['Retail', 'Metal', '2.125', 'retailGold', false],
    ['Bullion', 'Cash', '900', 'bullionCash', false],
    ['Bullion', 'Gold', '3.250', 'bullionGold', false],
    ['Bullion', 'Silver', '15.125', 'bullionSilver', false],
    ['Silver', 'Cash', '500', 'silverCash', false],
    ['Silver', 'Silver', '7.750', 'silverSilver', false],
    ['Chit', 'Cash', '200', 'chitCash', false],
    ['Retail', 'Cash', '100.25', 'retailCash', true],
  ];
  const expected = {};
  for (const [category, subtype, amount, field, gave] of entries) {
    await page.goto('/transactions');
    await page.locator('.atp-cat-name').filter({ hasText: new RegExp(`^${category}$`) }).click();
    await page.locator('.atp-cust-row').filter({ hasText: 'Local Smoke Customer' }).click();
    if (category === 'Chit') await page.locator('.atp-scheme-pill').filter({ hasText: /^CHIT$/ }).click();
    else await page.locator('.atp-sub-pill').filter({ hasText: new RegExp(`^${subtype}$`) }).click();
    if (gave) await page.getByRole('button', { name: /YOU GAVE/ }).click();
    await page.locator('.atp-amount-input').first().fill(amount);
    if (field === 'retailGold') {
      await page.locator('input[type=file]').setInputFiles({
        name: 'receipt.png', mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
      });
      await expect(page.getByAltText('receipt', { exact: true }).first()).toBeVisible();
    }
    await page.getByRole('button', { name: 'Save Transaction', exact: true }).click();
    await expect(page.locator('.popup-overlay')).toBeVisible();
    expected[field] = Number(((expected[field] || 0) + Number(amount) * (gave ? -1 : 1)).toFixed(3));
  }
  await page.reload();
  const snapshot = await page.evaluate(() => ({
    customers: JSON.parse(localStorage.getItem('oneledger_customers')),
    transactions: JSON.parse(localStorage.getItem('oneledger_transactions')),
  }));
  expect(snapshot.customers).toHaveLength(1);
  expect(snapshot.transactions).toHaveLength(9);
  for (const [field, amount] of Object.entries(expected)) expect(snapshot.customers[0][field]).toBeCloseTo(amount, 3);
  expect(snapshot.customers[0].cashBalance).toBe(2700.25);
  expect(snapshot.customers[0].goldBalance).toBe(5.375);
  expect(snapshot.customers[0].silverBalance).toBe(22.875);
  expect(snapshot.transactions.find(tx => tx.type === 'GOLD' && tx.category === 'RETAIL').images[0].url).toMatch(/^data:image\//);

  for (const path of ['/', '/customers', `/customers/${snapshot.customers[0].id}`, '/ledger', '/due', '/settings']) {
    await page.goto(path);
    await expect(page.locator('.app-main')).not.toBeEmpty();
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download Full Dump/ }).click();
  expect((await download).suggestedFilename()).toMatch(/^oneledger_full_dump_.*\.xlsx$/);
  await page.goto('/customers/missing');
  await expect(page.getByText('Customer not found.')).toBeVisible();
  await page.getByRole('button', { name: 'Go Back' }).click();
  await expect(page.getByText('Customer Management')).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('sample data loads and persists', async ({ page }) => {
  await login(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Load Dummy Data' }).click();
  await page.reload();
  const counts = await page.evaluate(() => [
    JSON.parse(localStorage.getItem('oneledger_customers')).length,
    JSON.parse(localStorage.getItem('oneledger_transactions')).length,
  ]);
  expect(counts).toEqual([15, 39]);
});
