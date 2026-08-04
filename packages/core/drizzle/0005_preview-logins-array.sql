-- previewLogins values change from a single login object to an array of logins
UPDATE "config" SET "preview_logins" = (
	SELECT coalesce(jsonb_object_agg("key", jsonb_build_array("value")), '{}'::jsonb)
	FROM jsonb_each("preview_logins")
);
