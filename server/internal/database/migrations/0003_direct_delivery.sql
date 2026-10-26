-- Direct delivery uses Go's SMTP client to reach the recipient's MX directly,
-- so no external SMTP relay needs to be installed or configured. Existing rows
-- keep using their configured relay.
ALTER TABLE domains
    ADD COLUMN delivery_mode text NOT NULL DEFAULT 'smtp'
        CHECK (delivery_mode IN ('direct', 'smtp')),
    ADD COLUMN dkim_selector text NOT NULL DEFAULT 'sendme',
    ADD COLUMN dkim_private_key_enc text NOT NULL DEFAULT '',
    ADD COLUMN dkim_public_key text NOT NULL DEFAULT '';
