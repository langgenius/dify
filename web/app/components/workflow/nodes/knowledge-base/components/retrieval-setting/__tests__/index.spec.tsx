import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDocLinkMock, resolveDocLink } from '@/app/components/workflow/__tests__/i18n'
import { IndexMethodEnum, RetrievalSearchMethodEnum } from '../../../types'
import RetrievalSetting from '../index'

const mockUseDocLink = createDocLinkMock()

vi.mock('@/context/i18n', () => ({
  useDocLink: () => mockUseDocLink,
}))

const baseProps = {
  onRetrievalSearchMethodChange: vi.fn(),
  onHybridSearchModeChange: vi.fn(),
  onWeightedScoreChange: vi.fn(),
  onTopKChange: vi.fn(),
  onScoreThresholdChange: vi.fn(),
  onScoreThresholdEnabledChange: vi.fn(),
  onRerankingModelEnabledChange: vi.fn(),
  onRerankingModelChange: vi.fn(),
  topK: 3,
  scoreThreshold: 0.5,
  isScoreThresholdEnabled: false,
}

describe('RetrievalSetting', () => {
  it('links to retrieval documentation and selects a qualified search method', async () => {
    const user = userEvent.setup()
    render(<RetrievalSetting {...baseProps} indexMethod={IndexMethodEnum.QUALIFIED} />)

    expect(
      screen.getByRole('link', { name: 'datasetSettings.form.retrievalSetting.learnMore' }),
    ).toHaveAttribute(
      'href',
      resolveDocLink('/use-dify/knowledge/create-knowledge/setting-indexing-methods'),
    )
    expect(screen.getByText('dataset.retrieval.semantic_search.title')).toBeInTheDocument()
    expect(screen.getByText('dataset.retrieval.full_text_search.title')).toBeInTheDocument()
    expect(screen.getByText('dataset.retrieval.hybrid_search.title')).toBeInTheDocument()
    await user.click(
      screen.getByRole('radio', { name: /dataset.retrieval.full_text_search.title/ }),
    )
    expect(baseProps.onRetrievalSearchMethodChange).toHaveBeenCalledWith(
      RetrievalSearchMethodEnum.fullText,
    )
  })

  it('should render only the economical retrieval method for economical indexing', () => {
    render(<RetrievalSetting {...baseProps} indexMethod={IndexMethodEnum.ECONOMICAL} />)

    expect(screen.getByText('dataset.retrieval.keyword_search.title')).toBeInTheDocument()
    expect(screen.queryByText('dataset.retrieval.semantic_search.title')).not.toBeInTheDocument()
    expect(screen.queryByText('dataset.retrieval.hybrid_search.title')).not.toBeInTheDocument()
  })
})
