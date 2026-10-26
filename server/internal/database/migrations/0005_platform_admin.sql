ALTER TABLE users
    ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

CREATE INDEX users_is_admin_idx ON users (is_admin) WHERE is_admin = true;
