import type { ProcessRuleResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { render, screen } from '@testing-library/react'
import { ProcessMode } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import RuleDetail from '../rule-detail'

vi.mock('@/utils', () => ({ getTextWidthWithCanvas: (text: string) => text.length * 8 }))
const rule: ProcessRuleResponse = {
  limits: { indexing_max_segmentation_tokens_length: 4000 },
  mode: ProcessMode.general,
  rules: {
    segmentation: { separator: '\n', max_tokens: 500, chunk_overlap: 50 },
    pre_processing_rules: [
      { id: 'remove_extra_spaces', enabled: true },
      { id: 'remove_urls_emails', enabled: false },
    ],
  },
}

it('summarizes the custom segmentation and only enabled cleaning rules', () => {
  render(
    <RuleDetail
      sourceData={rule}
      indexingType="high_quality"
      retrievalMethod={RETRIEVE_METHOD.semantic}
    />,
  )
  expect(screen.getByText('datasetDocuments.embedding.custom')).toBeInTheDocument()
  expect(screen.getByText('500')).toBeInTheDocument()
  expect(screen.getByText('datasetCreation.stepTwo.removeExtraSpaces')).toBeInTheDocument()
  expect(screen.queryByText('datasetCreation.stepTwo.removeUrlEmails')).not.toBeInTheDocument()
  expect(screen.getByText('datasetCreation.stepTwo.qualified')).toBeInTheDocument()
  expect(screen.getByText('dataset.retrieval.semantic_search.title')).toBeInTheDocument()
})

it('shows parent and child chunk limits for hierarchical processing', () => {
  render(
    <RuleDetail
      sourceData={{
        ...rule,
        mode: ProcessMode.parentChild,
        rules: {
          parent_mode: 'paragraph',
          segmentation: { separator: '\n', max_tokens: 1000 },
          subchunk_segmentation: { separator: '\n', max_tokens: 200 },
        },
      }}
      indexingType="high_quality"
    />,
  )
  expect(
    screen.getByText('datasetDocuments.embedding.hierarchical · dataset.parentMode.paragraph'),
  ).toBeInTheDocument()
  expect(
    screen.getByText(
      'datasetDocuments.embedding.parentMaxTokens 1000; datasetDocuments.embedding.childMaxTokens 200',
    ),
  ).toBeInTheDocument()
})

it('uses keyword retrieval for economical indexing', () => {
  render(
    <RuleDetail
      sourceData={rule}
      indexingType="economy"
      retrievalMethod={RETRIEVE_METHOD.semantic}
    />,
  )
  expect(screen.getByText('datasetCreation.stepTwo.economical')).toBeInTheDocument()
  expect(screen.getByText('dataset.retrieval.keyword_search.title')).toBeInTheDocument()
  expect(screen.queryByText('dataset.retrieval.semantic_search.title')).not.toBeInTheDocument()
})
