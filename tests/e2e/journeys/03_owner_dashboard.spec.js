import { test, expect } from '@playwright/test';

test.describe('Journey 3: Owner/Staff Walk-In Booking & Session Lifecycle', () => {
  test('should login as admin, create walk-in booking, and complete session lifecycle', async ({ page }) => {
    // 1. Navigate to Owner Dashboard (unauthenticated — should show Staff Sign In prompt)
    await page.goto('/admin');
    await expect(page.getByText('Owner Portal Restricted')).toBeVisible();

    // 2. Click "Staff Sign In" to open Auth Modal
    const signInBtn = page.getByRole('button', { name: /staff sign in/i });
    await signInBtn.click();

    // 3. Log in as Admin — actual submit button text is "Log In to Account"
    const authModal = page.locator('div.fixed', { hasText: /log in/i });
    await expect(authModal).toBeVisible();

    await authModal.locator('input[type="email"]').fill('admin@dndgaming.com');
    await authModal.locator('input[type="password"]').fill('AdminPass123!');
    await authModal.getByRole('button', { name: /log in to account/i }).click();

    // Wait for modal to close and dashboard to load
    await expect(authModal).not.toBeVisible({ timeout: 10000 });

    // 4. Verify Dashboard Loaded
    await expect(page.getByText('Lounge Operations & Control')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('ADMIN PORTAL')).toBeVisible();

    // Verify metrics are rendered
    await expect(page.getByText('Available Rigs')).toBeVisible();
    await expect(page.getByText('Active Sessions')).toBeVisible();

    // 5. Open Walk-In Booking Modal
    const walkInBtn = page.getByRole('button', { name: /walk-in booking/i });
    await walkInBtn.click();

    const walkInModal = page.locator('div.fixed', { hasText: /immediate walk-in desk/i });
    await expect(walkInModal).toBeVisible();

    // 6. Fill Walk-In Form
    // Select station (pick first available — index 0 is "-- Choose Station --")
    const stationSelect = walkInModal.locator('select').first();
    await stationSelect.selectOption({ index: 1 });

    // Enter customer name
    await walkInModal.getByPlaceholder('Walk-In Player').fill('Walk-In Tester');

    // Select Duration: 1 Hour
    const durationSelect = walkInModal.locator('select').nth(1);
    await durationSelect.selectOption('60');

    // 7. Submit Walk-In
    const startBtn = walkInModal.getByRole('button', { name: /start walk-in/i });
    await startBtn.click();

    // 8. Verify Success Notice
    await expect(
      page.getByText(/walk-in booking created and session started/i)
    ).toBeVisible({ timeout: 15000 });

    // Walk-In modal should be closed
    await expect(walkInModal).not.toBeVisible();

    // 9. Verify ACTIVE booking appears in the table
    const activeFilterBtn = page.getByRole('button', { name: /^ACTIVE$/i });
    await activeFilterBtn.click();

    const bookingsTable = page.locator('table');
    await expect(bookingsTable).toBeVisible();
    await expect(bookingsTable.getByText('Walk-In Tester')).toBeVisible();
    await expect(bookingsTable.getByText('ACTIVE').first()).toBeVisible();

    // 10. Complete Session (Check Out) — handle window.confirm dialog
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    const checkOutBtn = bookingsTable.getByRole('button', { name: /check out/i });
    await expect(checkOutBtn).toBeVisible();
    await checkOutBtn.click();

    // 11. Verify session completed — notice appears
    await expect(
      page.getByText(/session checked out and completed/i)
    ).toBeVisible({ timeout: 10000 });

    // 12. Switch to ALL filter and verify COMPLETED status
    const allFilterBtn = page.getByRole('button', { name: /^ALL$/i });
    await allFilterBtn.click();

    // Search for our walk-in to confirm it's now COMPLETED
    const searchInput = page.getByPlaceholder(/search ref, station, or player/i);
    await searchInput.fill('Walk-In Tester');

    await expect(bookingsTable.getByText('COMPLETED').first()).toBeVisible({ timeout: 10000 });
    await expect(bookingsTable.getByText('Walk-In Tester')).toBeVisible();
  });
});
