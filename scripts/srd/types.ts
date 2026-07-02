export type SRDType =
  | "spell"
  | "monster"
  | "rule"
  | "item"
  | "class"
  | "race"
  | "background"
  | "feat"
  | "condition"
  | "feature";

export type SRDRecord = {
  type: SRDType;
  name: string;
  slug: string;
  source: string;
  content: string;
  data?: Record<string, unknown>;
};
