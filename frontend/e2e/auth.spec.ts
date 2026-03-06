import { test, expect } from './fixtures';

test.describe('Auth flow', () => {
  test('registrazione e redirect a dashboard', async ({ page }) => {
    await page.goto('/register');
    await page.fill('[data-testid="email-input"]', 'e2e_reg@test.com');
    await page.fill('[data-testid="password-input"]', 'TestPass123!');
    await page.fill('[data-testid="confirm-password-input"]', 'TestPass123!');
    await page.click('[data-testid="register-button"]');
    await expect(page).toHaveURL(/\/(setup-keys|dashboard)/);
  });

  test('login con credenziali sbagliate mostra errore', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="email-input"]', 'wrong@test.com');
    await page.fill('[data-testid="password-input"]', 'WrongPass!');
    await page.click('[data-testid="login-button"]');
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible({
      timeout: 5000,
    });
    await expect(page).toHaveURL(/\/login/);
  });

  test('logout pulisce sessione', async ({ loggedInPage: page }) => {
    await page.click('[data-testid="user-menu"]');
    await page.click('[data-testid="logout-button"]');
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
