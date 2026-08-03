import type { EmployeeMetrics, AggregateMetrics } from "./metrics";

export interface EmployeeReportBlock {
  employeeName: string;
  department: string | null;
  position: string | null;
  metrics: EmployeeMetrics;
  aiSummary: string;
  issues: {
    key: string;
    summary: string;
    currentStatus: string;
    statusHistory: { from: string | null; to: string; at: Date }[];
    workDoneNote: string | null;
    followsDocumentation: boolean | null;
  }[];
}

export interface DirectionReportBlock {
  directionName: string;
  employees: EmployeeReportBlock[];
  metrics: AggregateMetrics;
}

export interface ProjectReportBlock {
  projectName: string;
  directions: DirectionReportBlock[];
  metrics: AggregateMetrics;
}

export interface CompanyReportData {
  companyName: string;
  period: "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  projects: ProjectReportBlock[];
  overallMetrics: AggregateMetrics;
}
