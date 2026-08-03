-- Direction.githubRepo (single) -> Direction.githubRepos (array)
ALTER TABLE "Direction" ADD COLUMN "githubRepos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Direction" SET "githubRepos" = ARRAY["githubRepo"] WHERE "githubRepo" IS NOT NULL;

ALTER TABLE "Direction" DROP COLUMN "githubRepo";
