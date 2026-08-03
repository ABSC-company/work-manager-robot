-- CreateEnum
CREATE TYPE "DocumentationType" AS ENUM ('GITHUB_REPO', 'FILE');

-- CreateEnum
CREATE TYPE "ReportPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('GENERATING', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "OccasionType" AS ENUM ('ONE_TIME', 'RECURRING');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY_DAY', 'MONTHLY_BEFORE_END');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "githubOrg" TEXT,
    "githubToken" TEXT,
    "jiraBaseUrl" TEXT,
    "jiraEmail" TEXT,
    "jiraApiToken" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
    "groupChatId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAdmin" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "fullName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "fullName" TEXT NOT NULL,
    "department" TEXT,
    "position" TEXT,
    "jiraAccountId" TEXT,
    "githubUsername" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Direction" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "githubRepo" TEXT,
    "jiraProjectKey" TEXT,
    "jiraBoardIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Direction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectionEmployee" (
    "id" TEXT NOT NULL,
    "directionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,

    CONSTRAINT "DirectionEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Documentation" (
    "id" TEXT NOT NULL,
    "directionId" TEXT NOT NULL,
    "type" "DocumentationType" NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "filePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Documentation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT,
    "period" "ReportPeriod" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'GENERATING',
    "filePath" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportApproval" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "companyAdminId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "period" "ReportPeriod" NOT NULL,
    "hour" INTEGER NOT NULL DEFAULT 19,
    "minute" INTEGER NOT NULL DEFAULT 0,
    "dayOfWeek" INTEGER DEFAULT 5,
    "daysBeforeMonthEnd" INTEGER DEFAULT 3,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Occasion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "OccasionType" NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "frequency" "RecurrenceFrequency",
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "daysBeforeMonthEnd" INTEGER,
    "hour" INTEGER NOT NULL DEFAULT 9,
    "minute" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFiredAt" TIMESTAMP(3),

    CONSTRAINT "Occasion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyAdmin_companyId_telegramId_key" ON "CompanyAdmin"("companyId", "telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_companyId_telegramUsername_key" ON "Employee"("companyId", "telegramUsername");

-- CreateIndex
CREATE UNIQUE INDEX "Project_companyId_name_key" ON "Project"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Direction_projectId_name_key" ON "Direction"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DirectionEmployee_directionId_employeeId_key" ON "DirectionEmployee"("directionId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportApproval_reportId_companyAdminId_key" ON "ReportApproval"("reportId", "companyAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportSchedule_companyId_period_key" ON "ReportSchedule"("companyId", "period");

-- AddForeignKey
ALTER TABLE "CompanyAdmin" ADD CONSTRAINT "CompanyAdmin_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Direction" ADD CONSTRAINT "Direction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectionEmployee" ADD CONSTRAINT "DirectionEmployee_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectionEmployee" ADD CONSTRAINT "DirectionEmployee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documentation" ADD CONSTRAINT "Documentation_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportApproval" ADD CONSTRAINT "ReportApproval_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportApproval" ADD CONSTRAINT "ReportApproval_companyAdminId_fkey" FOREIGN KEY ("companyAdminId") REFERENCES "CompanyAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occasion" ADD CONSTRAINT "Occasion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

