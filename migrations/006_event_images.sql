-- Image bytes are stored externally; only the URL is kept here.
ALTER TABLE events ADD COLUMN IF NOT EXISTS image_url TEXT;
