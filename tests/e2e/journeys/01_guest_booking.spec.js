import { test, expect } from '@playwright/test';

test.describe('Journey 1: Guest Customer Booking Flow', () => {
  test('should complete guest booking from station browse to mock payment confirmation', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('DND Gaming Hub', { timeout: 15000 });

    // Select PC-01 station
    const stationCard = page.locator('div.group', { hasText: 'PC-01' });
    await expect(stationCard).toBeVisible();
    await stationCard.getByRole('button', { name: /select slots/i }).click();

    // Slot picker modal
    const modal = page.locator('div.fixed');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: /tomorrow/i }).click();
    await modal.getByRole('button', { name: '1 hour' }).click();

    // Select first available time slot (buttons with "Open" text)
    const slotButton = modal.getByRole('button', { name: /\d{2}:\d{2}\s+(AM|PM)\s+Open/i }).first();
    await expect(slotButton).toBeVisible({ timeout: 10000 });
    await slotButton.click();

    // Fill guest details
    await modal.getByPlaceholder('Alex Mercer').fill('Jane Guest');
    await modal.getByPlaceholder('alex@gaming.com').fill('jane.guest@example.com');
    await modal.getByPlaceholder('+91 9876543210').fill('9876543210');

    // Hold slots
    const holdBtn = modal.getByRole('button', { name: /hold slots/i });
    await expect(holdBtn).toBeEnabled({ timeout: 5000 });
    await holdBtn.click();

    // Booking Confirmation Page
    await page.waitForURL(/\/booking\//, { timeout: 15000 });
    await expect(page.getByText(/DND-\d{8}-/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Liquid-Cooled Titan Rig #1')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Complete Confirmation' })).toBeVisible();

    // Pay — actual button text is "Pay & Confirm (Sandbox)"
    const payBtn = page.getByRole('button', { name: /pay.*confirm.*sandbox/i });
    await expect(payBtn).toBeVisible();
    await payBtn.click();

    // Payment Sandbox Modal
    const paymentModal = page.locator('div.fixed', { hasText: /Payment Simulator/i });
    await expect(paymentModal).toBeVisible();
    await paymentModal.getByRole('button', { name: /simulate successful payment/i }).click();

    // Verify confirmed
    await expect(page.getByText('Reservation Confirmed')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Rig Ready For Check-in/i)).toBeVisible();
    await expect(page.getByText('Liquid-Cooled Titan Rig #1')).toBeVisible();
  });
});
