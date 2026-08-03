import type { EmployeeMetrics, AggregateMetrics } from "./metrics";

export interface IdleSummary {
  totalDays: number;
  totalHours: number;
  noBacklogDays: number;
  noActivityDays: number;
}

export interface EmployeeReportBlock {
  employeeName: string;
  department: string | null;
  position: string | null;
  metrics: EmployeeMetrics;
  aiSummary: string;
  efficiencyAssessment: string; // AI judgment combining Jira metrics, GitHub activity and idle days for the period
  estimatedWorkedHours: number | null; // AI-estimated hours actually worked within the report period
  periodHours: number; // wall-clock length of the report period, in hours — context for estimatedWorkedHours
  idleSummary: IdleSummary;
  commits: { message: string; date: Date; url: string }[];
  issues: {
    key: string;
    summary: string;
    currentStatus: string;
    statusHistory: { from: string | null; to: string; at: Date }[];
    durationHours: number | null; // time from creation to completion, null if not completed yet
    commits: { message: string; date: Date; url: string }[];
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
