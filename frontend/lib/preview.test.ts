import { describe, it, expect } from 'vitest';
import { decryptAndPreview } from './preview';
import { generateKey, encryptFileChunked, bytesToHex } from './crypto';

describe('preview', () => {
  it('decryptAndPreview returns valid object URL', async () => {
    const dek = await generateKey();
    const original = new TextEncoder().encode('test content');
    const encrypted = await encryptFileChunked(original, dek, 'test-id');
    const blob = new Blob([encrypted]);
    const url = await decryptAndPreview(blob, bytesToHex(dek), 'text/plain', 'test-id');
    expect(url).toMatch(/^blob:/);
    URL.revokeObjectURL(url);
  });
});
