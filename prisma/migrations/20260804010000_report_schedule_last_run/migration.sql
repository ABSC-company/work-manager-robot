-- Track the last time a ReportSchedule actually fired, so manual /report runs (same period, same day)
-- can no longer make the scheduler silently skip the automatic send.
ALTER TABLE "ReportSchedule" ADD COLUMN "lastRunAt" TIMESTAMP(3);
