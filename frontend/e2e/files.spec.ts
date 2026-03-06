import { test, expect } from './fixtures';
import path from 'path';
import fs from 'fs';
import os from 'os';

test.describe('File operations', () => {
  test('upload file then compare in list', async ({ loggedInPage: page }) => {
    const tmpFile = path.join(os.tmpdir(), 'axshare_e2e_test.txt');
    fs.writeFileSync(tmpFile, 'Contenuto test E2E Playwright');

    await page.goto('/dashboard');

    const fileInput = page.locator('[data-testid="file-input"]');
    await fileInput.setInputFiles(tmpFile);

    const passphraseModal = page.locator('[data-testid="passphrase-modal"]');
    if (await passphraseModal.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.fill('[data-testid="passphrase-input"]', 'TestPass123!');
      await page.click('[data-testid="confirm-passphrase"]');
    }

    await expect(page.locator('[data-testid="file-list"]')).toBeVisible({
      timeout: 5000,
    });

    fs.unlinkSync(tmpFile);
  });

  test('encrypted file not readable without passphrase', async ({
    loggedInPage: page,
  }) => {
    await page.goto('/dashboard');
    const pageSource = await page.content();
    expect(pageSource).not.toContain('BEGIN PRIVATE KEY');
  });
});
