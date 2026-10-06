import type { Session } from "@workspace/db";
import { interpret } from "../domain/interpreter";
import { interpretWithLlm, isLlmConfigured } from "../domain/llm-interpreter";

export type FilterInput = { queryText: string; pivotWorkId: string | null };

export async function prepareFilterSession(current: Session, input: FilterInput): Promise<Session> {
  const query = input.queryText.trim() || null;
  const unchangedQuery = query === current.query;
  let interpretation = unchangedQuery ? current.queryInterpretation : query ? interpret(query) : null;
  if (!unchangedQuery && query && interpretation?.source !== "curated" && isLlmConfigured()) {
    interpretation = await interpretWithLlm(query, interpret(query)) ?? interpretation;
  }
  const changed = !unchangedQuery || input.pivotWorkId !== current.pivotBookId;
  return {
    ...current,
    query,
    queryPromptId: unchangedQuery ? current.queryPromptId : null,
    querySource: query ? "freetext" : null,
    queryInterpretation: interpretation,
    pivotBookId: input.pivotWorkId,
    rankingVersion: current.rankingVersion + (changed ? 1 : 0),
    updatedAt: changed ? new Date() : current.updatedAt,
  };
}

/** Called inside the row-locked DB transaction; a failed computation never writes. */
export async function computeThenCommit<T>(compute: () => Promise<T>, commit: () => Promise<void>): Promise<T> {
  const response = await compute();
  // Exercise serialization before committing as well as ranking/DTO assembly.
  JSON.stringify(response);
  await commit();
  return response;
}