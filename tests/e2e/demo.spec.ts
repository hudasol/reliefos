import { expect, test } from '@playwright/test';

// The rehearsed demonstration sequence, end to end in a real browser against the real server.
// PayPal is not configured in this environment, so the test also asserts that checkout is refused
// rather than simulated. The sandbox payment itself is covered by tests/sandbox (needs credentials).

test('flood mission: plan → drill → policy rejection → recovery → approval → analytics → audit', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/License Key Not Found|\*{10}|unlocked for trial|watermark/.test(m.text())
    )
      consoleErrors.push(m.text());
  });

  await page.goto('/');
  await expect(
    page.getByText('Riverside flood response — East Shelter resupply').first(),
  ).toBeVisible();
  await expect(page.getByText('This mission has not been planned yet')).toBeVisible();

  // 1-3. Plan: requirements, products, buyer agent, DEADMAN validation.
  await page.getByRole('button', { name: 'Plan mission' }).first().click();
  await expect(page).toHaveURL(/\/procurement$/);
  await expect(page.getByRole('heading', { name: 'Proposal v1' })).toBeVisible();
  await expect(page.getByText(/Allowed by DEADMAN/).first()).toBeVisible();

  // 4-6. Adversarial drill exposes a violation; the gate rejects it with evidence.
  await page.getByRole('link', { name: 'Security lab' }).click();
  await page
    .getByText('Carrier delay on a critical item')
    .locator('..')
    .getByRole('button', { name: 'Run drill' })
    .click();
  await expect(page.getByText(/Blocked by DEADMAN/).first()).toBeVisible();
  await expect(page.getByText('DELIVERY_DEADLINE').first()).toBeVisible();

  // 7. Recovery plan, re-validated.
  await page.getByRole('link', { name: 'Procurement' }).click();
  await page.getByRole('button', { name: 'Generate recovery plan' }).click();
  await expect(page.getByRole('heading', { name: 'Proposal v2' })).toBeVisible();
  await expect(page.getByText(/Allowed by DEADMAN/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Changes from v1/ })).toBeVisible();

  // 9. Human approval bound to the reviewed terms.
  await page.getByRole('button', { name: 'Review & approve' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Approver name').fill('Dana Reyes');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: /^Approve \$/ }).click();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();

  // 10. Without sandbox credentials the deployment refuses to take payment rather than simulating it.
  await page.getByRole('link', { name: 'Approvals & payments' }).click();
  await expect(page.getByText('PayPal Sandbox is not configured on this deployment')).toBeVisible();
  await expect(page.getByRole('button', { name: /Pay .* with PayPal Sandbox/ })).toBeDisabled();
  await expect(page.getByText('Dana Reyes').first()).toBeVisible();

  // 8. Dashboard and schedule reflect the persisted plan.
  await page.getByRole('link', { name: 'Decision center' }).click();
  await expect(page.getByText('Budget authority (current plan goods)')).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByText('DEADMAN verdict on current proposal')).toBeVisible();
  await page.getByRole('tab', { name: 'Sourcing grid' }).click();
  await expect(page.locator('.ag-root').first()).toBeVisible();

  await page.getByRole('link', { name: 'Delivery schedule' }).click();
  await expect(page.locator('.b-scheduler').first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('East Shelter · intake').first()).toBeVisible();

  // Audit trail and outcome report.
  await page.getByRole('link', { name: 'Audit trail' }).click();
  await expect(page.getByText(/Hash chain intact/).first()).toBeVisible();
  await expect(page.getByText('policy.rejected').first()).toBeVisible();
  await expect(page.getByText('approval.granted').first()).toBeVisible();

  await page.getByRole('link', { name: 'Mission report' }).click();
  await expect(page.getByText('What the policy gate stopped')).toBeVisible();

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});

test('security suite runs from the UI and enforces all eight scenarios', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Security lab' }).click();
  await page.getByRole('button', { name: 'Run suite' }).click();
  await expect(page.getByText('8/8 enforced')).toBeVisible({ timeout: 90_000 });
});
