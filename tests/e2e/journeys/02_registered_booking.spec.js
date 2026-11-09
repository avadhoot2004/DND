import { test, expect } from '@playwright/test';

test.describe('Journey 2: Registered Customer Booking Flow', () => {
  test('should login as registered customer, reserve slot, pay, and verify in My Reservations', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('DND Gaming Hub', { timeout: 15000 });

    // Login
    await page.locator('header').getByRole('button', { name: /log in/i }).click();
    const authModal = page.locator('div.fixed', { hasText: /log in/i });
    await expect(authModal).toBeVisible();
    await authModal.locator('input[type="email"]').fill('pro_gamer@dndgaming.com');
    await authModal.locator('input[type="password"]').fill('CustomerPass123!');
    await authModal.getByRole('button', { name: /log in to account/i }).click();
    await expect(authModal).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('header')).toContainText('Pro Gamer Customer', { timeout: 10000 });

    // Select PS5-01
    const stationCard = page.locator('div.group', { hasText: 'PS5-01' });
    await expect(stationCard).toBeVisible();
    await stationCard.getByRole('button', { name: /select slots/i }).click();

    // Slot picker
    const slotModal = page.locator('div.fixed', { hasText: /reserve playstation 5/i });
    await expect(slotModal).toBeVisible();
    await slotModal.getByRole('button', { name: /tomorrow/i }).click();

    const slotButton = slotModal.getByRole('button', { name: /\d{2}:\d{2}\s+(AM|PM)\s+Open/i }).first();
    await expect(slotButton).toBeVisible({ timeout: 10000 });
    await slotButton.click();

    // Guest inputs hidden for logged-in user
    await expect(slotModal.getByPlaceholder('Alex Mercer')).not.toBeVisible();

    // Hold
    const holdBtn = slotModal.getByRole('button', { name: /hold slots/i });
    await expect(holdBtn).toBeEnabled({ timeout: 5000 });
    await holdBtn.click();

    // Booking Confirmation Page
    await page.waitForURL(/\/booking\//, { timeout: 15000 });
    const bookingRefElement = page.getByText(/DND-\d{8}-[A-Z0-9]+/);
    await expect(bookingRefElement.first()).toBeVisible({ timeout: 10000 });
    const fullText = await bookingRefElement.first().textContent();
    const bookingRef = fullText.match(/DND-\d{8}-[A-Z0-9]+/)?.[0];

    // Pay — actual button text is "Pay & Confirm (Sandbox)"
    const payBtn = page.getByRole('button', { name: /pay.*confirm.*sandbox/i });
    await expect(payBtn).toBeVisible({ timeout: 10000 });
    await payBtn.click();

    const payModal = page.locator('div.fixed', { hasText: /Payment Simulator/i });
    await expect(payModal).toBeVisible();
    await payModal.getByRole('button', { name: /simulate successful payment/i }).click();

    // Verified confirmed
    await expect(page.getByText('Reservation Confirmed')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Rig Ready For Check-in/i)).toBeVisible();

    // My Reservations
    await page.locator('header').getByRole('link', { name: /my reservations/i }).click();
    await page.waitForURL('/my-bookings');
    await expect(page.locator('h1')).toContainText('My Gaming Reservations');
    await expect(page.getByText('PS5-01')).toBeVisible();
    await expect(page.getByText('PlayStation 5 OLED Suite #1')).toBeVisible();
    await expect(page.locator('span', { hasText: 'CONFIRMED' }).first()).toBeVisible();
  });
});
