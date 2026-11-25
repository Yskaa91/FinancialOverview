// Enum-like column values. SQLite has no enums, so these unions are the single
// source of truth and every write is validated against them (Zod at the edge).

export const ACCOUNT_TYPES = ["CHECKING", "SAVINGS", "BROKER", "CREDIT_CARD"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const INSTITUTIONS = ["ASN", "PAYPAL", "ICS", "OTHER"] as const;
export type Institution = (typeof INSTITUTIONS)[number];

export const STATEMENT_SOURCES = ["ASN", "PAYPAL", "ICS"] as const;
export type StatementSource = (typeof STATEMENT_SOURCES)[number];

export const CATEGORY_KINDS = ["EXPENSE", "INCOME", "TRANSFER"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const CATEGORY_SOURCES = ["MANUAL", "RULE", "AI", "NONE"] as const;
export type CategorySource = (typeof CATEGORY_SOURCES)[number];

export const REVIEW_STATES = ["OK", "SUGGESTED", "UNCATEGORIZED"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const RULE_MATCH_ON = ["DESCRIPTION", "COUNTERPARTY", "IBAN", "MERCHANT"] as const;
export type RuleMatchOn = (typeof RULE_MATCH_ON)[number];

export const RULE_OPERATORS = ["CONTAINS", "EQUALS", "REGEX"] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

export const TRADE_SIDES = ["BUY", "SELL"] as const;
export type TradeSide = (typeof TRADE_SIDES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CHECKING: "Checking",
  SAVINGS: "Savings",
  BROKER: "Brokerage",
  CREDIT_CARD: "Credit card",
};
