export type SectionName =
  | "Account Summary"
  | "Deposits and Other Credits"
  | "Withdrawals and Other Debits"
  | "Checks"
  | "Service Fees"
  | "Daily Ledger Balances";

export type NameCategory = "" | "Operation" | "Inventory";

export type ParsedSections = {
  "Account Summary": Array<{ Description: string; Value: string }>;
  "Deposits and Other Credits": Array<{
    Date: string;
    Description: string;
    Amount: string;
  }>;
  "Withdrawals and Other Debits": Array<{
    Date: string;
    Description: string;
    Amount: string;
  }>;
  Checks: Array<{ Date: string; "Check #": string; Amount: string; Name: string }>;
  "Service Fees": Array<{ Date: string; Description: string; Amount: string }>;
  "Daily Ledger Balances": Array<{ Date: string; "Balance ($)": string }>;
};

export type ParseStatementResult = {
  sections: ParsedSections;
  uniqueNames: string[];
  warnings: string[];
};

export type ExportSheetPayload = {
  title: string;
  sections: ParsedSections;
  labels: Record<string, NameCategory>;
};
