export type GoldenQuestionDraft = {
  annotation: string
  evidenceText: string
  expectedEvidenceIds: string[]
  matchPolicy: 'all' | 'any'
  question: string
  tags: string[]
}
