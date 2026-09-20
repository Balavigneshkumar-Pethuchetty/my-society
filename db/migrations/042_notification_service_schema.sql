-- Notification Service Schema Isolation & Tables
-- This migration creates the schema, role, and tables for the notification-service.

DO $$
BEGIN
  -- Create notification_role if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_role') THEN
    CREATE ROLE notification_role WITH LOGIN PASSWORD :'NOTIFICATION_DB_PASSWORD';
    GRANT CONNECT ON DATABASE :'DB_NAME' TO notification_role;
  END IF;
END
$$;

-- Create notification schema
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'notification') THEN
    CREATE SCHEMA notification AUTHORIZATION notification_role;
  END IF;
END
$$;

-- Grant permissions
ALTER SCHEMA notification OWNER TO notification_role;
GRANT USAGE ON SCHEMA notification TO notification_role;
GRANT CREATE ON SCHEMA notification TO notification_role;

-- Notification logs table (tracks all sent notifications)
CREATE TABLE IF NOT EXISTS notification.notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  event_name VARCHAR(255) NOT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'none', -- 'novu', 'legacy_email', 'legacy_sms', 'legacy_telegram', 'none'
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'failed', 'bounced'
  channels_sent VARCHAR[] DEFAULT ARRAY[]::VARCHAR[], -- array of channels: 'email', 'sms', 'telegram', 'in_app'
  payload JSONB,
  error_message TEXT,
  delivery_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT check_valid_source CHECK (source IN ('novu', 'legacy_email', 'legacy_sms', 'legacy_telegram', 'none')),
  CONSTRAINT check_valid_status CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'bounced'))
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_user_id ON notification.notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification.notification_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status ON notification.notification_logs(status);
CREATE INDEX IF NOT EXISTS idx_notification_logs_event_name ON notification.notification_logs(event_name);

-- Grant SELECT, INSERT, UPDATE on tables to notification_role
GRANT SELECT, INSERT, UPDATE ON notification.notification_logs TO notification_role;

-- Notification service configuration table
CREATE TABLE IF NOT EXISTS notification.notification_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  novu_enabled BOOLEAN DEFAULT TRUE,
  novu_strategy VARCHAR(50) DEFAULT 'NOVU_WITH_FALLBACK', -- 'NOVU_ONLY', 'NOVU_WITH_FALLBACK', 'FALLBACK_ONLY'
  email_enabled BOOLEAN DEFAULT TRUE,
  sms_telegram_enabled BOOLEAN DEFAULT TRUE,
  background_tasks_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT check_single_config CHECK (id = 1),
  CONSTRAINT check_valid_strategy CHECK (novu_strategy IN ('NOVU_ONLY', 'NOVU_WITH_FALLBACK', 'FALLBACK_ONLY'))
);

GRANT SELECT, INSERT, UPDATE ON notification.notification_config TO notification_role;

-- Insert default configuration
INSERT INTO notification.notification_config (id, novu_enabled, novu_strategy, email_enabled, sms_telegram_enabled, background_tasks_enabled)
VALUES (1, TRUE, 'NOVU_WITH_FALLBACK', TRUE, TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Notification delivery attempts table (for retry logic)
CREATE TABLE IF NOT EXISTS notification.notification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_log_id UUID NOT NULL REFERENCES notification.notification_logs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  channel VARCHAR(50) NOT NULL, -- 'email', 'sms', 'telegram', 'in_app', 'novu'
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'success', 'failed'
  error_message TEXT,
  response_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT check_valid_channel CHECK (channel IN ('email', 'sms', 'telegram', 'in_app', 'novu'))
);

CREATE INDEX IF NOT EXISTS idx_notification_attempts_log_id ON notification.notification_attempts(notification_log_id);
CREATE INDEX IF NOT EXISTS idx_notification_attempts_channel ON notification.notification_attempts(channel);

GRANT SELECT, INSERT, UPDATE ON notification.notification_attempts TO notification_role;

-- Comment on tables
COMMENT ON TABLE notification.notification_logs IS 'Centralized audit trail for all notifications sent through the system';
COMMENT ON TABLE notification.notification_attempts IS 'Tracks individual delivery attempts per channel for retry logic';
COMMENT ON TABLE notification.notification_config IS 'Runtime configuration for notification service behavior';
