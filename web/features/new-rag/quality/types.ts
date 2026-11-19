import type { KnowledgeFsGoldenQuestionEvidenceCandidateResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'

export type GoldenQuestionDraft = {
  annotation: string
  expectedEvidenceIds: string[]
  matchPolicy: 'all' | 'any'
  question: string
  tags: string[]
}

export type GoldenQuestionEvidenceOption = Pick<
  KnowledgeFsGoldenQuestionEvidenceCandidateResponse,
  'node_id' | 'section_path' | 'text'
> &
  Partial<Pick<KnowledgeFsGoldenQuestionEvidenceCandidateResponse, 'score'>>
