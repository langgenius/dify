import type { AnswerTraceRepository } from "./answer-trace-repository";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";

import type { AnswerTrace, AuthSubject } from "@knowledge/core";

export async function getTenantScopedAnswerTrace({
  answerTraceRepository,
  spaces,
  subject,
  traceId,
}: {
  readonly answerTraceRepository: AnswerTraceRepository;
  readonly spaces: KnowledgeSpaceRepository;
  readonly subject: AuthSubject;
  readonly traceId: string;
}): Promise<AnswerTrace | null> {
  const trace = await answerTraceRepository.getById(traceId);

  if (!trace) {
    return null;
  }

  const space = await spaces.get({
    id: trace.knowledgeSpaceId,
    tenantId: subject.tenantId,
  });

  return space ? trace : null;
}
