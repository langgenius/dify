import type { ProcessRuleResponse } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProcessMode } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import RuleDetail from '../rule-detail'

vi.mock('@/app/components/datasets/documents/detail/metadata', () => ({
  FieldInfo: ({ label, displayedValue }: { label: string, displayedValue: string }) => (
    <div data-testid="field-info">
      <span data-testid="field-label">{label}</span>
      <span data-testid="field-value">{displayedValue}</span>
    </div>
  ),
}))
vi.mock('../../icons', () => ({
  indexMethodIcon: { economical: '/icons/economical.svg', high_quality: '/icons/hq.svg' },
  retrievalIcon: { fullText: '/icons/ft.svg', hybrid: '/icons/hy.svg', vector: '/icons/vec.svg' },
}))

describe('RuleDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const makeSourceData = (overrides: Partial<ProcessRuleResponse> = {}): ProcessRuleResponse => ({
    mode: ProcessMode.general,
    rules: {
      segmentation: { separator: '\n', max_tokens: 500, chunk_overlap: 50 },
      pre_processing_rules: [
        { id: 'remove_extra_spaces', enabled: true },
        { id: 'remove_urls_emails', enabled: false },
      ],
    },
    ...overrides,
  } as ProcessRuleResponse)

  it('should render mode, segment length, text cleaning, index mode, and retrieval fields', () => {
    render(
      <RuleDetail
        sourceData={makeSourceData()}
        indexingType="high_quality"
        retrievalMethod={RETRIEVE_METHOD.semantic}
      />,
    )

    const fieldInfos = screen.getAllByTestId('field-info')
    // mode, segmentLength, textCleaning, indexMode, retrievalSetting = 5
    expect(fieldInfos.length).toBe(5)
  })

  it('should display "custom" for general mode', () => {
    render(
      <RuleDetail
        sourceData={makeSourceData({ mode: ProcessMode.general })}
        indexingType="high_quality"
      />,
    )

    const values = screen.getAllByTestId('field-value')
    expect(values[0].textContent).toContain('embedding.custom')
  })

  it('should display hierarchical mode with parent mode label', () => {
    render(
      <RuleDetail
        sourceData={makeSourceData({
          mode: ProcessMode.parentChild,
          rules: {
            parent_mode: 'paragraph',
            segmentation: { separator: '\n', max_tokens: 1000, chunk_overlap: 50 },
            subchunk_segmentation: { max_tokens: 200 },
            pre_processing_rules: [],
          } as unknown as ProcessRuleResponse['rules'],
        })}
        indexingType="high_quality"
      />,
    )

    const values = screen.getAllByTestId('field-value')
    expect(values[0].textContent).toContain('embedding.hierarchical')
  })

  it('should display "-" when no sourceData mode', () => {
    render(
      <RuleDetail
        sourceData={makeSourceData({ mode: undefined as unknown as ProcessMode })}
        indexingType="high_quality"
      />,
    )

    const values = screen.getAllByTestId('field-value')
    expect(values[0].textContent).toBe('-')
  })

  it('should display segment length for general mode', () => {
    render(
      <RuleDetail
        sourceData={makeSourceData()}
        indexingType="high_quality"
      />,
    )

    const values = screen.getAllByTestId('field-value')
    expect(values[1].textContent).toBe('500')
  })

  it('should display enabled pre-processing rules', () => {
    render(
      <RuleDetail
        sourceData={makeSourceData()}
        indexingType="high_quality"
      />,
    )

    const values = screen.getAllByTestId('field-value')
    // Only remove_extra_spaces is enabled
    expect(values[2].textContent).toContain('stepTwo.removeExtraSpaces')
  })

  it('should display economical index mode', () => {
    render(
      <RuleDetail
        sourceData={makeSourceData()}
        indexingType="economy"
      />,
    )

    const values = screen.getAllByTestId('field-value')
    // Index mode field is 4th (index 3)
    expect(values[3].textContent).toContain('stepTwo.economical')
  })

  it('should display qualified index mode for high_quality', () => {
    render(
      <RuleDetail
        sourceData={makeSourceData()}
        indexingType="high_quality"
      />,
    )

    const values = screen.getAllByTestId('field-value')
    expect(values[3].textContent).toContain('stepTwo.qualified')
  })
})
