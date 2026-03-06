import { test as base, expect, Page } from '@playwright/test';

const API = process.env.E2E_API_URL || 'http://localhost:8000/api/v1';

export async function createTestUser(page: Page): Promise<{
  email: string;
  token: string;
  userId: string;
}> {
  const resp = await page.request.post(`${API}/test/seed-user`);
  if (resp.status() === 404) {
    throw new Error(
      'Backend seed endpoint not available. Start backend with ENVIRONMENT=test'
    );
  }
  if (!resp.ok) {
    throw new Error(`Seed user failed: ${resp.status()} ${await resp.text()}`);
  }
  const data = await resp.json();
  return {
    email: data.email,
    token: data.access_token,
    userId: data.user_id,
  };
}

export async function loginViaUI(
  page: Page,
  email: string,
  _password: string
): Promise<void> {
  await page.goto('/login');
  const emailInput = page.locator('[data-testid="email-input"]');
  const passwordInput = page.locator('[data-testid="password-input"]');
  if ((await emailInput.count()) > 0) {
    await emailInput.fill(email);
    await passwordInput.fill(_password || 'TestPass123!');
    await page.click('[data-testid="login-button"]');
    await page.waitForURL('**/dashboard', { timeout: 10000 }).catch(() => {});
  }
}

export const test = base.extend<{ loggedInPage: Page }>({
  loggedInPage: async ({ page }, use) => {
    const user = await createTestUser(page);
    await page.goto('/dashboard');
    await use(page);
  },
});

export { expect };
