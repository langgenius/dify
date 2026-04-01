import type { RetrievalConfig } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RETRIEVE_METHOD } from '@/types/app'
import ModifyRetrievalModal from '../modify-retrieval-modal'

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, variant }: { children: React.ReactNode, onClick: () => void, variant?: string }) => (
    <button data-testid={variant === 'primary' ? 'save-button' : 'cancel-button'} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/app/components/datasets/common/check-rerank-model', () => ({
  isReRankModelSelected: vi.fn(() => true),
}))

vi.mock('@/app/components/datasets/common/retrieval-method-config', () => ({
  default: ({ value, onChange }: { value: RetrievalConfig, onChange: (v: RetrievalConfig) => void }) => (
    <div data-testid="retrieval-method-config">
      <span>{value.search_method}</span>
      <button data-testid="change-config" onClick={() => onChange({ ...value, search_method: RETRIEVE_METHOD.hybrid })}>change</button>
    </div>
  ),
}))

vi.mock('@/app/components/datasets/common/economical-retrieval-method-config', () => ({
  default: () => <div data-testid="economical-config" />,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: () => ({ data: [] }),
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: () => 'model-name',
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

vi.mock('../../../base/toast', () => ({
  default: { notify: vi.fn() },
}))

vi.mock('../../settings/utils', () => ({
  checkShowMultiModalTip: () => false,
}))

describe('ModifyRetrievalModal', () => {
  const defaultProps = {
    indexMethod: 'high_quality',
    value: {
      search_method: 'semantic_search',
      reranking_enable: false,
      reranking_model: {
        reranking_provider_name: '',
        reranking_model_name: '',
      },
    } as RetrievalConfig,
    isShow: true,
    onHide: vi.fn(),
    onSave: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when isShow is false', () => {
    const { container } = render(<ModifyRetrievalModal {...defaultProps} isShow={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('should render title when isShow is true', () => {
    render(<ModifyRetrievalModal {...defaultProps} />)
    expect(screen.getByText('datasetSettings.form.retrievalSetting.title')).toBeInTheDocument()
  })

  it('should render high quality retrieval config for high_quality index', () => {
    render(<ModifyRetrievalModal {...defaultProps} />)
    expect(screen.getByTestId('retrieval-method-config')).toBeInTheDocument()
  })

  it('should render economical config for non high_quality index', () => {
    render(<ModifyRetrievalModal {...defaultProps} indexMethod="economy" />)
    expect(screen.getByTestId('economical-config')).toBeInTheDocument()
  })

  it('should call onHide when cancel button clicked', () => {
    render(<ModifyRetrievalModal {...defaultProps} />)
    fireEvent.click(screen.getByTestId('cancel-button'))
    expect(defaultProps.onHide).toHaveBeenCalled()
  })

  it('should call onSave with retrieval config when save clicked', () => {
    render(<ModifyRetrievalModal {...defaultProps} />)
    fireEvent.click(screen.getByTestId('save-button'))
    expect(defaultProps.onSave).toHaveBeenCalled()
  })

  it('should render learn more link', () => {
    render(<ModifyRetrievalModal {...defaultProps} />)
    expect(screen.getByText('datasetSettings.form.retrievalSetting.learnMore')).toBeInTheDocument()
  })
})
