'use client';

import { useState, useEffect, useRef } from 'react';
import { decryptAndPreview } from '@/lib/preview';

interface FilePreviewProps {
  fileId: string;
  dekHex: string;
  mimeType: string;
}

export function FilePreview({ fileId, dekHex, mimeType }: FilePreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let revoked = false;
    async function loadPreview() {
      try {
        setError(null);
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        const response = await fetch(`/api/v1/files/${fileId}/download`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);
        const blob = await response.blob();
        const url = await decryptAndPreview(blob, dekHex, mimeType, fileId);
        if (!revoked) {
          if (urlRef.current) URL.revokeObjectURL(urlRef.current);
          urlRef.current = url;
          setPreviewUrl(url);
        } else {
          URL.revokeObjectURL(url);
        }
      } catch (e) {
        if (!revoked) setError(e instanceof Error ? e.message : 'Errore anteprima');
      }
    }
    loadPreview();
    return () => {
      revoked = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [fileId, dekHex, mimeType]);

  if (error) return <div className="text-red-600">Errore: {error}</div>;
  if (!previewUrl) return <div>Caricamento anteprima...</div>;
  if (mimeType.startsWith('image/'))
    return <img src={previewUrl} alt="Preview" className="max-w-full" />;
  if (mimeType === 'application/pdf')
    return <iframe src={previewUrl} title="PDF preview" className="w-full h-96" />;
  return <div>Anteprima non disponibile per questo tipo di file</div>;
}
