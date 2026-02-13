import type { Query } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import QueryInput from '../index'

vi.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}))

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, disabled, loading }: { children: React.ReactNode, onClick: () => void, disabled?: boolean, loading?: boolean }) => (
    <button data-testid="submit-button" onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  ),
}))

vi.mock('@/app/components/datasets/common/image-uploader/image-uploader-in-retrieval-testing', () => ({
  default: ({ textArea, actionButton }: { textArea: React.ReactNode, actionButton: React.ReactNode }) => (
    <div data-testid="image-uploader">
      {textArea}
      {actionButton}
    </div>
  ),
}))

vi.mock('@/app/components/datasets/common/retrieval-method-info', () => ({
  getIcon: () => '/test-icon.png',
}))

vi.mock('@/app/components/datasets/hit-testing/modify-external-retrieval-modal', () => ({
  default: () => <div data-testid="external-retrieval-modal" />,
}))

vi.mock('../textarea', () => ({
  default: ({ text }: { text: string }) => <textarea data-testid="textarea" defaultValue={text} />,
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: () => false,
}))

describe('QueryInput', () => {
  const defaultProps = {
    onUpdateList: vi.fn(),
    setHitResult: vi.fn(),
    setExternalHitResult: vi.fn(),
    loading: false,
    queries: [{ content: 'test query', content_type: 'text_query', file_info: null }] satisfies Query[],
    setQueries: vi.fn(),
    isExternal: false,
    onClickRetrievalMethod: vi.fn(),
    retrievalConfig: { search_method: 'semantic_search' } as RetrievalConfig,
    isEconomy: false,
    hitTestingMutation: vi.fn(),
    externalKnowledgeBaseHitTestingMutation: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render title', () => {
    render(<QueryInput {...defaultProps} />)
    expect(screen.getByText('datasetHitTesting.input.title')).toBeInTheDocument()
  })

  it('should render textarea with query text', () => {
    render(<QueryInput {...defaultProps} />)
    expect(screen.getByTestId('textarea')).toBeInTheDocument()
  })

  it('should render submit button', () => {
    render(<QueryInput {...defaultProps} />)
    expect(screen.getByTestId('submit-button')).toBeInTheDocument()
  })

  it('should disable submit button when text is empty', () => {
    const props = {
      ...defaultProps,
      queries: [{ content: '', content_type: 'text_query', file_info: null }] satisfies Query[],
    }
    render(<QueryInput {...props} />)
    expect(screen.getByTestId('submit-button')).toBeDisabled()
  })

  it('should render retrieval method for non-external mode', () => {
    render(<QueryInput {...defaultProps} />)
    expect(screen.getByText('dataset.retrieval.semantic_search.title')).toBeInTheDocument()
  })

  it('should render settings button for external mode', () => {
    render(<QueryInput {...defaultProps} isExternal={true} />)
    expect(screen.getByText('datasetHitTesting.settingTitle')).toBeInTheDocument()
  })

  it('should disable submit button when text exceeds 200 characters', () => {
    const props = {
      ...defaultProps,
      queries: [{ content: 'a'.repeat(201), content_type: 'text_query', file_info: null }] satisfies Query[],
    }
    render(<QueryInput {...props} />)
    expect(screen.getByTestId('submit-button')).toBeDisabled()
  })

  it('should disable submit button when loading', () => {
    render(<QueryInput {...defaultProps} loading={true} />)
    expect(screen.getByTestId('submit-button')).toBeDisabled()
  })
})
