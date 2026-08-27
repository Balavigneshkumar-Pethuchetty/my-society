import '../i18n';
import React, { useRef, useState } from 'react';
import { Alert, Button, CircularProgress, Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import { apiBase } from '../api';

interface PhotoUploaderProps {
  token: string;
  passId?: string;
  anonymousId?: string;
  onUploaded: () => void;
}

export function PhotoUploader({ token, passId, anonymousId, onUploaded }: PhotoUploaderProps) {
  const { t } = useTranslation('visitors');
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const params = new URLSearchParams(passId ? { pass_id: passId } : { anonymous_id: anonymousId! });
      const res = await fetch(`${apiBase('visitors')}/gate/photos?${params}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
      onUploaded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <Stack spacing={1}>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])}
      />
      <Button
        size="small"
        variant="outlined"
        startIcon={uploading ? <CircularProgress size={14} /> : <CameraAltIcon />}
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? t('photoUploader.uploading') : t('photoUploader.capture')}
      </Button>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
    </Stack>
  );
}
