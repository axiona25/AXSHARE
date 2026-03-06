import { test, expect } from './fixtures';
import { createTestUser } from './fixtures';

const API = process.env.E2E_API_URL || 'http://localhost:8000/api/v1';

test.describe('Share link pubblico', () => {
  test('pagina share link pubblica accessibile senza login', async ({
    page,
  }) => {
    const user = await createTestUser(page);

    const hash = 'a'.repeat(64);
    const iv = 'b'.repeat(24);
    const metadata = JSON.stringify({
      folder_id: null,
      name_encrypted: 'enc_share_test',
      mime_type_encrypted: 'enc_mime',
      file_key_encrypted: 'enc_key',
      encryption_iv: iv,
      content_hash: hash,
      size_bytes: 12,
    });

    const uploadResp = await page.request.post(`${API}/files/upload`, {
      headers: { Authorization: `Bearer ${user.token}` },
      multipart: {
        metadata,
        file: {
          name: 'share_test.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('test content'),
        },
      },
    });
    expect(uploadResp.ok()).toBeTruthy();
    const uploadData = (await uploadResp.json()) as { file_id: string };
    const fileId = uploadData.file_id;

    const linkResp = await page.request.post(
      `${API}/files/${fileId}/share-links`,
      {
        headers: { Authorization: `Bearer ${user.token}` },
        data: { label: 'playwright-test' },
      }
    );
    expect(linkResp.ok()).toBeTruthy();
    const linkData = (await linkResp.json()) as { token: string };
    const token = linkData.token;

    await page.context().clearCookies();
    await page.goto(`/share/${token}`);

    await expect(page.locator('[data-testid="share-page"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="download-button"]')).toBeVisible();
  });

  test('share link con password mostra form password', async ({ page }) => {
    const user = await createTestUser(page);

    const metadata = JSON.stringify({
      folder_id: null,
      name_encrypted: 'enc',
      mime_type_encrypted: 'enc',
      file_key_encrypted: 'enc_key',
      encryption_iv: 'd'.repeat(24),
      content_hash: 'c'.repeat(64),
      size_bytes: 11,
    });

    const uploadResp = await page.request.post(`${API}/files/upload`, {
      headers: { Authorization: `Bearer ${user.token}` },
      multipart: {
        metadata,
        file: {
          name: 'pwd_test.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('pwd content'),
        },
      },
    });
    expect(uploadResp.ok()).toBeTruthy();
    const uploadData = (await uploadResp.json()) as { file_id: string };

    const linkResp = await page.request.post(
      `${API}/files/${uploadData.file_id}/share-links`,
      {
        headers: { Authorization: `Bearer ${user.token}` },
        data: { password: 'LinkPass123', label: 'pwd-link' },
      }
    );
    expect(linkResp.ok()).toBeTruthy();
    const linkData = (await linkResp.json()) as { token: string };

    await page.context().clearCookies();
    await page.goto(`/share/${linkData.token}`);

    await expect(page.locator('[data-testid="password-form"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible();
  });
});
