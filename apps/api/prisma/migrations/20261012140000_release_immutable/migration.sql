-- Release rows are immutable (ADR 0015).
--
-- A BEFORE UPDATE OR DELETE row trigger raises an exception, so an application bug
-- (or a stray manual statement) cannot edit or remove a published release.
--
-- Limits, on purpose and documented:
--  * it does NOT fire on TRUNCATE (the test harness truncates every table);
--  * the table owner / a superuser can still `ALTER TABLE ... DISABLE TRIGGER` or set
--    `session_replication_role = replica`, so this guards bugs, not a malicious DBA;
--  * `prisma migrate diff` / `pnpm db:drift` cannot see triggers or functions, so
--    test/db/releaseImmutable.test.ts is the only guard against removing it.
--  * the foreign keys from Release to Brand and User are RESTRICT, so those deletes
--    are refused earlier (23503) and never reach this trigger.

CREATE FUNCTION "release_is_immutable"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Release rows are immutable (% on "Release" is not allowed)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "Release_immutable"
  BEFORE UPDATE OR DELETE ON "Release"
  FOR EACH ROW EXECUTE FUNCTION "release_is_immutable"();
