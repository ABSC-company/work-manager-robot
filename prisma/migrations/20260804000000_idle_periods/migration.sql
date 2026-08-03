-- CreateEnum
CREATE TYPE "IdleReason" AS ENUM ('NO_BACKLOG_TASKS', 'NO_ACTIVITY');

-- CreateTable
CREATE TABLE "IdlePeriod" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "reason" "IdleReason" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdlePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdlePeriod_employeeId_date_key" ON "IdlePeriod"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "IdlePeriod" ADD CONSTRAINT "IdlePeriod_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
