-- Occasion.dayOfWeek (single) -> Occasion.daysOfWeek (array)
ALTER TABLE "Occasion" ADD COLUMN "daysOfWeek" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

UPDATE "Occasion" SET "daysOfWeek" = ARRAY["dayOfWeek"] WHERE "dayOfWeek" IS NOT NULL;

ALTER TABLE "Occasion" DROP COLUMN "dayOfWeek";
