-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "draftRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "brandId" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "type" TEXT,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "brandId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "css" TEXT NOT NULL,
    "cssSha256" TEXT NOT NULL,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_organizationId_slug_key" ON "Brand"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Token_brandId_path_key" ON "Token"("brandId", "path");

-- CreateIndex
CREATE INDEX "Release_createdById_idx" ON "Release"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Release_brandId_number_key" ON "Release"("brandId", "number");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CHECK constraints (hand-written: schema.prisma cannot express them).
-- Defense in depth: the database rejects bad data even if the application has a
-- bug or someone writes to it directly. `prisma migrate diff` cannot see these;
-- test/db/constraints.test.ts is their guard. (ADR 0012)
-- ---------------------------------------------------------------------------

-- Slugs: lowercase letters and digits, single hyphens between segments.
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_slug_format"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_slug_format"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Token paths: the dotted form of the same segment pattern ("semantic.color.blue-500").
ALTER TABLE "Token" ADD CONSTRAINT "Token_path_format"
  CHECK ("path" ~ '^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$');

-- Emails are stored lowercase (the application lowercases before writing).
ALTER TABLE "User" ADD CONSTRAINT "User_email_lowercase"
  CHECK ("email" = lower("email"));

-- Token.type is NULL or one of the types tokens-core supports. NULL is allowed
-- ONLY for an alias ("{path.to.token}"), which inherits its target's type; group
-- $type is already resolved into literals by flatten.
ALTER TABLE "Token" ADD CONSTRAINT "Token_type_supported"
  CHECK ("type" IS NULL OR "type" IN ('color', 'dimension', 'fontFamily', 'fontWeight', 'number'));
ALTER TABLE "Token" ADD CONSTRAINT "Token_type_null_only_for_alias"
  CHECK ("type" IS NOT NULL OR (jsonb_typeof("value") = 'string' AND ("value" #>> '{}') ~ '^\{[^{}]+\}$'));

-- Releases are numbered from 1 and carry the SHA-256 (lowercase hex) of their CSS.
ALTER TABLE "Release" ADD CONSTRAINT "Release_number_positive"
  CHECK ("number" > 0);
ALTER TABLE "Release" ADD CONSTRAINT "Release_cssSha256_format"
  CHECK ("cssSha256" ~ '^[0-9a-f]{64}$');