ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin', 'admin', 'editor', 'viewer'));
-- Login lockout and TOTP replay guard (used for the 2FA account only).
ALTER TABLE users
  ADD COLUMN failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN totp_last_step bigint;
