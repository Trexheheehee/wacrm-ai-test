-- Add n8n_webhook_url to accounts table
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS n8n_webhook_url TEXT;

-- Refresh schema cache for PostgREST
NOTIFY pgrst, 'reload schema';
