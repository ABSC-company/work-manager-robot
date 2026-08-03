import { Prisma } from "@prisma/client";

/** True if err is a Prisma unique constraint violation (P2002), e.g. from a duplicate create. */
export function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
