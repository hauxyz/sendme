ALTER TABLE campaigns
    ADD COLUMN from_email text NOT NULL DEFAULT '',
    ADD COLUMN from_name text NOT NULL DEFAULT '',
    ADD COLUMN reply_to text NOT NULL DEFAULT '';
