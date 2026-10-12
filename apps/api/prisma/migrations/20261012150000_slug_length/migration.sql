-- Slugs of organizations and brands are at most 63 characters (ADR 0014 amendment).
--
-- 63 is the DNS label limit. The application enforces it (src/slug.ts) and so do the
-- public routes; this CHECK is the database's own backstop, next to the existing
-- *_slug_format constraints from the init migration. Slugs are ASCII by the format
-- rule, so char_length equals the byte length.
--
-- Hand-written: schema.prisma cannot express CHECK constraints, so `pnpm db:drift`
-- cannot see these. test/db/constraints.test.ts is their only guard.
--
-- An existing row longer than 63 characters would make this fail loudly (there is no
-- deployed database yet, and the format CHECK has never limited the length, so check
-- production data before applying this anywhere that has real users).

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_slug_length" CHECK (char_length("slug") <= 63);

ALTER TABLE "Brand"
  ADD CONSTRAINT "Brand_slug_length" CHECK (char_length("slug") <= 63);
