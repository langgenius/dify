import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { RetrievalConfig } from '@/types/app'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChunkingMode } from '@/models/datasets'
import { IndexingType } from '../../hooks'
import { IndexingModeSection } from '../indexing-mode-section'

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children?: React.ReactNode, href?: string, className?: string }) => <a href={href} {...props}>{children}</a>,
}))

// Mock external domain components
vi.mock('@/app/components/datasets/common/retrieval-method-config', () => ({
  default: ({ onChange, disabled }: { value?: RetrievalConfig, onChange?: (val: Record<string, unknown>) => void, disabled?: boolean }) => (
    <div data-testid="retrieval-method-config" data-disabled={disabled}>
      <button onClick={() => onChange?.({ search_method: 'updated' })}>Change Retrieval</button>
    </div>
  ),
}))

vi.mock('@/app/components/datasets/common/economical-retrieval-method-config', () => ({
  default: ({ disabled }: { value?: RetrievalConfig, onChange?: (val: Record<string, unknown>) => void, disabled?: boolean }) => (
    <div data-testid="economical-retrieval-config" data-disabled={disabled}>
      Economical Config
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({ onSelect, readonly }: { onSelect?: (val: Record<string, string>) => void, readonly?: boolean }) => (
    <div data-testid="model-selector" data-readonly={readonly}>
      <button onClick={() => onSelect?.({ provider: 'openai', model: 'text-embedding-3-small' })}>Select Model</button>
    </div>
  ),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.dify.ai${path}`,
}))

const ns = 'datasetCreation'

const createDefaultModel = (overrides?: Partial<DefaultModel>): DefaultModel => ({
  provider: 'openai',
  model: 'text-embedding-ada-002',
  ...overrides,
})

const createRetrievalConfig = (): RetrievalConfig => ({
  search_method: 'semantic_search' as RetrievalConfig['search_method'],
  reranking_enable: false,
  reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
  top_k: 3,
  score_threshold_enabled: false,
  score_threshold: 0,
})

const defaultProps = {
  indexType: IndexingType.QUALIFIED,
  hasSetIndexType: false,
  docForm: ChunkingMode.text,
  embeddingModel: createDefaultModel(),
  embeddingModelList: [],
  retrievalConfig: createRetrievalConfig(),
  showMultiModalTip: false,
  isModelAndRetrievalConfigDisabled: false,
  isQAConfirmDialogOpen: false,
  onIndexTypeChange: vi.fn(),
  onEmbeddingModelChange: vi.fn(),
  onRetrievalConfigChange: vi.fn(),
  onQAConfirmDialogClose: vi.fn(),
  onQAConfirmDialogConfirm: vi.fn(),
}

describe('IndexingModeSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render index mode title', () => {
      render(<IndexingModeSection {...defaultProps} />)
      expect(screen.getByText(`${ns}.stepTwo.indexMode`)).toBeInTheDocument()
    })

    it('should render qualified option when not locked to economical', () => {
      render(<IndexingModeSection {...defaultProps} />)
      expect(screen.getByText(`${ns}.stepTwo.qualified`)).toBeInTheDocument()
    })

    it('should render economical option when not locked to qualified', () => {
      render(<IndexingModeSection {...defaultProps} />)
      expect(screen.getByText(`${ns}.stepTwo.economical`)).toBeInTheDocument()
    })

    it('should only show qualified option when hasSetIndexType and type is qualified', () => {
      render(<IndexingModeSection {...defaultProps} hasSetIndexType indexType={IndexingType.QUALIFIED} />)
      expect(screen.getByText(`${ns}.stepTwo.qualified`)).toBeInTheDocument()
      expect(screen.queryByText(`${ns}.stepTwo.economical`)).not.toBeInTheDocument()
    })

    it('should only show economical option when hasSetIndexType and type is economical', () => {
      render(<IndexingModeSection {...defaultProps} hasSetIndexType indexType={IndexingType.ECONOMICAL} />)
      expect(screen.getByText(`${ns}.stepTwo.economical`)).toBeInTheDocument()
      expect(screen.queryByText(`${ns}.stepTwo.qualified`)).not.toBeInTheDocument()
    })
  })

  describe('Embedding Model', () => {
    it('should show model selector when indexType is qualified', () => {
      render(<IndexingModeSection {...defaultProps} indexType={IndexingType.QUALIFIED} />)
      expect(screen.getByTestId('model-selector')).toBeInTheDocument()
    })

    it('should not show model selector when indexType is economical', () => {
      render(<IndexingModeSection {...defaultProps} indexType={IndexingType.ECONOMICAL} />)
      expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    })

    it('should mark model selector as readonly when disabled', () => {
      render(<IndexingModeSection {...defaultProps} isModelAndRetrievalConfigDisabled />)
      expect(screen.getByTestId('model-selector')).toHaveAttribute('data-readonly', 'true')
    })

    it('should call onEmbeddingModelChange when model selected', () => {
      const onEmbeddingModelChange = vi.fn()
      render(<IndexingModeSection {...defaultProps} onEmbeddingModelChange={onEmbeddingModelChange} />)
      fireEvent.click(screen.getByText('Select Model'))
      expect(onEmbeddingModelChange).toHaveBeenCalledWith({ provider: 'openai', model: 'text-embedding-3-small' })
    })
  })

  describe('Retrieval Config', () => {
    it('should show RetrievalMethodConfig when qualified', () => {
      render(<IndexingModeSection {...defaultProps} indexType={IndexingType.QUALIFIED} />)
      expect(screen.getByTestId('retrieval-method-config')).toBeInTheDocument()
    })

    it('should show EconomicalRetrievalMethodConfig when economical', () => {
      render(<IndexingModeSection {...defaultProps} indexType={IndexingType.ECONOMICAL} />)
      expect(screen.getByTestId('economical-retrieval-config')).toBeInTheDocument()
    })

    it('should call onRetrievalConfigChange from qualified config', () => {
      const onRetrievalConfigChange = vi.fn()
      render(<IndexingModeSection {...defaultProps} onRetrievalConfigChange={onRetrievalConfigChange} />)
      fireEvent.click(screen.getByText('Change Retrieval'))
      expect(onRetrievalConfigChange).toHaveBeenCalledWith({ search_method: 'updated' })
    })
  })

  describe('Index Type Switching', () => {
    it('should call onIndexTypeChange when switching to qualified', () => {
      const onIndexTypeChange = vi.fn()
      render(<IndexingModeSection {...defaultProps} indexType={IndexingType.ECONOMICAL} onIndexTypeChange={onIndexTypeChange} />)
      const qualifiedCard = screen.getByText(`${ns}.stepTwo.qualified`).closest('[class*="rounded-xl"]')!
      fireEvent.click(qualifiedCard)
      expect(onIndexTypeChange).toHaveBeenCalledWith(IndexingType.QUALIFIED)
    })

    it('should disable economical when docForm is QA', () => {
      render(<IndexingModeSection {...defaultProps} docForm={ChunkingMode.qa} />)
      // The economical option card should have disabled styling
      const economicalText = screen.getByText(`${ns}.stepTwo.economical`)
      const card = economicalText.closest('[class*="rounded-xl"]')
      expect(card).toHaveClass('pointer-events-none')
    })
  })

  describe('High Quality Tip', () => {
    it('should show high quality tip when qualified is selected and not locked', () => {
      render(<IndexingModeSection {...defaultProps} indexType={IndexingType.QUALIFIED} hasSetIndexType={false} />)
      expect(screen.getByText(`${ns}.stepTwo.highQualityTip`)).toBeInTheDocument()
    })

    it('should not show high quality tip when index type is locked', () => {
      render(<IndexingModeSection {...defaultProps} indexType={IndexingType.QUALIFIED} hasSetIndexType />)
      expect(screen.queryByText(`${ns}.stepTwo.highQualityTip`)).not.toBeInTheDocument()
    })
  })

  describe('QA Confirm Dialog', () => {
    it('should call onQAConfirmDialogClose when cancel clicked', () => {
      const onClose = vi.fn()
      render(<IndexingModeSection {...defaultProps} isQAConfirmDialogOpen onQAConfirmDialogClose={onClose} />)
      const cancelBtns = screen.getAllByText(`${ns}.stepTwo.cancel`)
      fireEvent.click(cancelBtns[0])
      expect(onClose).toHaveBeenCalled()
    })

    it('should call onQAConfirmDialogConfirm when confirm clicked', () => {
      const onConfirm = vi.fn()
      render(<IndexingModeSection {...defaultProps} isQAConfirmDialogOpen onQAConfirmDialogConfirm={onConfirm} />)
      fireEvent.click(screen.getByText(`${ns}.stepTwo.switch`))
      expect(onConfirm).toHaveBeenCalled()
    })
  })

  describe('Dataset Settings Link', () => {
    it('should show settings link when economical and hasSetIndexType', () => {
      render(<IndexingModeSection {...defaultProps} hasSetIndexType indexType={IndexingType.ECONOMICAL} datasetId="ds-123" />)
      expect(screen.getByText(`${ns}.stepTwo.datasetSettingLink`)).toBeInTheDocument()
      expect(screen.getByText(`${ns}.stepTwo.datasetSettingLink`).closest('a')).toHaveAttribute('href', '/datasets/ds-123/settings')
    })

    it('should show settings link under model selector when disabled', () => {
      render(<IndexingModeSection {...defaultProps} isModelAndRetrievalConfigDisabled datasetId="ds-456" />)
      const links = screen.getAllByText(`${ns}.stepTwo.datasetSettingLink`)
      expect(links.length).toBeGreaterThan(0)
    })
  })
})
