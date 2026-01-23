import { fireEvent, render, screen } from '@testing-library/react'
import { RETRIEVE_METHOD } from '@/types/app'
import EconomicalRetrievalMethodConfig from './index'

// Mock dependencies
vi.mock('../../settings/option-card', () => ({
  default: ({ children, title, description, disabled, id }: {
    children?: React.ReactNode
    title?: string
    description?: React.ReactNode
    disabled?: boolean
    id?: string
  }) => (
    <div data-testid="option-card" data-title={title} data-id={id} data-disabled={disabled}>
      <div>{description}</div>
      {children}
    </div>
  ),
}))

vi.mock('../retrieval-param-config', () => ({
  default: ({ value, onChange, type }: {
    value: Record<string, unknown>
    onChange: (value: Record<string, unknown>) => void
    type?: string
  }) => (
    <div data-testid="retrieval-param-config" data-type={type}>
      <button onClick={() => onChange({ ...value, newProp: 'changed' })}>
        Change Value
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/base/icons/src/vender/knowledge', () => ({
  VectorSearch: () => <svg data-testid="vector-search-icon" />,
}))

describe('EconomicalRetrievalMethodConfig', () => {
  const mockOnChange = vi.fn()
  const defaultProps = {
    value: {
      search_method: RETRIEVE_METHOD.keywordSearch,
      reranking_enable: false,
      reranking_model: {
        reranking_provider_name: '',
        reranking_model_name: '',
      },
      top_k: 2,
      score_threshold_enabled: false,
      score_threshold: 0.5,
    },
    onChange: mockOnChange,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render correctly', () => {
    render(<EconomicalRetrievalMethodConfig {...defaultProps} />)

    expect(screen.getByTestId('option-card')).toBeInTheDocument()
    expect(screen.getByTestId('retrieval-param-config')).toBeInTheDocument()
    // Check if title and description are rendered (mocked i18n returns key)
    expect(screen.getByText('dataset.retrieval.keyword_search.description')).toBeInTheDocument()
  })

  it('should pass correct props to OptionCard', () => {
    render(<EconomicalRetrievalMethodConfig {...defaultProps} disabled={true} />)

    const card = screen.getByTestId('option-card')
    expect(card).toHaveAttribute('data-disabled', 'true')
    expect(card).toHaveAttribute('data-id', RETRIEVE_METHOD.keywordSearch)
  })

  it('should pass correct props to RetrievalParamConfig', () => {
    render(<EconomicalRetrievalMethodConfig {...defaultProps} />)

    const config = screen.getByTestId('retrieval-param-config')
    expect(config).toHaveAttribute('data-type', RETRIEVE_METHOD.keywordSearch)
  })

  it('should handle onChange events', () => {
    render(<EconomicalRetrievalMethodConfig {...defaultProps} />)

    fireEvent.click(screen.getByText('Change Value'))

    expect(mockOnChange).toHaveBeenCalledTimes(1)
    expect(mockOnChange).toHaveBeenCalledWith({
      ...defaultProps.value,
      newProp: 'changed',
    })
  })

  it('should default disabled prop to false', () => {
    render(<EconomicalRetrievalMethodConfig {...defaultProps} />)
    const card = screen.getByTestId('option-card')
    expect(card).toHaveAttribute('data-disabled', 'false')
  })
})
