import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Alert,
  Box,
  CircularProgress,
  Chip,
  Typography,
  Stack,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { userService } from '../api/userService';

interface UsernameEditDialogProps {
  open: boolean;
  onClose: () => void;
  currentUsername: string | null;
  token: string;
  onSave: (newUsername: string | null) => void;
}

export const UsernameEditDialog: React.FC<UsernameEditDialogProps> = ({
  open,
  onClose,
  currentUsername,
  token,
  onSave,
}) => {
  const [username, setUsername] = useState(currentUsername || '');
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    available: boolean;
    username: string;
    suggestions: string[];
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce username check
  useEffect(() => {
    if (!username.trim()) {
      setCheckResult(null);
      return;
    }

    if (username === currentUsername) {
      setCheckResult(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setChecking(true);
        setError(null);
        const result = await userService.checkUsername(token, username);
        setCheckResult(result);
      } catch (err) {
        setError((err as Error).message);
        setCheckResult(null);
      } finally {
        setChecking(false);
      }
    }, 500); // Debounce 500ms

    return () => clearTimeout(timer);
  }, [username, token, currentUsername]);

  const handleSave = async () => {
    if (!username.trim() || !checkResult?.available) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await userService.update(token, { username: username.trim() });
      onSave(username.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    setUsername('');
    setCheckResult(null);
  };

  const isValid = username.trim().length >= 3 && username.trim().length <= 50;
  const canSave = isValid && checkResult?.available && !saving;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Set Your Alias Name</DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Stack spacing={2}>
          <Typography variant="body2" color="textSecondary">
            Choose an alias name to appear in the community directory. This helps you communicate
            with other residents without revealing your personal information.
          </Typography>

          <TextField
            fullWidth
            label="Alias Name"
            placeholder="e.g., phoenix, silverstar, etc."
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={saving}
            error={!isValid && username.length > 0}
            helperText={
              username.length > 0 && !isValid
                ? 'Alias name must be 3-50 characters'
                : 'Use letters, numbers, underscores'
            }
            autoFocus
          />

          {/* Availability Status */}
          {username.trim() && username !== currentUsername && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {checking ? (
                <>
                  <CircularProgress size={20} />
                  <Typography variant="body2">Checking availability...</Typography>
                </>
              ) : checkResult ? (
                <>
                  {checkResult.available ? (
                    <>
                      <CheckCircleIcon sx={{ color: '#4caf50', fontSize: 20 }} />
                      <Typography variant="body2" sx={{ color: '#4caf50' }}>
                        "{checkResult.username}" is available!
                      </Typography>
                    </>
                  ) : (
                    <>
                      <ErrorIcon sx={{ color: '#f44336', fontSize: 20 }} />
                      <Typography variant="body2" sx={{ color: '#f44336' }}>
                        "{checkResult.username}" is already taken
                      </Typography>
                    </>
                  )}
                </>
              ) : null}
            </Box>
          )}

          {/* Suggestions */}
          {checkResult && !checkResult.available && checkResult.suggestions.length > 0 && (
            <Box>
              <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                Suggested alternatives:
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {checkResult.suggestions.map((suggestion) => (
                  <Chip
                    key={suggestion}
                    label={suggestion}
                    onClick={() => setUsername(suggestion)}
                    clickable
                    variant="outlined"
                  />
                ))}
              </Box>
            </Box>
          )}

          {/* Error Alert */}
          {error && <Alert severity="error">{error}</Alert>}

          {/* Info Alert */}
          <Alert severity="info" sx={{ mt: 1 }}>
            You can change your alias name anytime from your profile settings.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleClear} disabled={saving || !username}>
          Clear
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!canSave}
          sx={{ minWidth: 100 }}
        >
          {saving ? <CircularProgress size={20} /> : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
