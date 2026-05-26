import type { ParsedEventCandidate, Source } from "../../types/models";

export interface SourceRunResult {
  source: Source;
  candidates: ParsedEventCandidate[];
  status: string;
  error?: string;
}

export interface SourceAdapter {
  type: Source["type"];
  run(source: Source): Promise<SourceRunResult>;
}
