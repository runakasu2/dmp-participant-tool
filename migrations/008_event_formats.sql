ALTER TABLE events ADD COLUMN IF NOT EXISTS format VARCHAR(16);
CREATE OR REPLACE FUNCTION infer_event_format(label TEXT) RETURNS TEXT
LANGUAGE SQL IMMUTABLE AS $$
 SELECT CASE WHEN (o::int+a::int+b::int)=1 THEN
 CASE WHEN o THEN 'original' WHEN a THEN 'advance' ELSE '2block' END ELSE NULL END
 FROM (SELECT COALESCE(label,'') LIKE '%オリジナル%' AS o,
 COALESCE(label,'') LIKE '%アドバンス%' AS a,
 translate(COALESCE(label,''),'２','2') LIKE '%2ブロック%' AS b) flags
$$;
CREATE OR REPLACE FUNCTION set_event_format() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.format IS NULL THEN NEW.format := infer_event_format(NEW.event_name); END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER events_infer_format BEFORE INSERT OR UPDATE ON events
 FOR EACH ROW EXECUTE FUNCTION set_event_format();
UPDATE events SET format=infer_event_format(event_name) WHERE format IS NULL;
CREATE INDEX IF NOT EXISTS events_format_date_idx ON events(format,event_date);
