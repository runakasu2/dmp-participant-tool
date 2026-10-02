-- Format is now extracted from the fetched DMP HTML by the application.
-- Keep previously stored values; do not overwrite them from event names on insert/upsert.
DROP TRIGGER IF EXISTS events_infer_format ON events;
