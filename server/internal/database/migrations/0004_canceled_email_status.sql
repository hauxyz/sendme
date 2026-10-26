ALTER TABLE emails
    DROP CONSTRAINT IF EXISTS emails_status_check;

ALTER TABLE emails
    ADD CONSTRAINT emails_status_check
    CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'canceled'));
