import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { RetrievalConfig } from '@/types/app'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ChunkingMode } from '@/models/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { IndexingType } from '../../hooks'
import { IndexingModeSection } from '../indexing-mode-section'

// Indexing choices and conversion confirmation are owned here; model/config editors have their own suites.
vi.mock('@/app/components/datasets/common/retrieval-method-config', () => ({ default: () => null }))
vi.mock('@/app/components/datasets/common/economical-retrieval-method-config', () => ({
  default: () => null,
}))
vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  ModelSelector: () => null,
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
    it('should only show qualified option when hasSetIndexType and type is qualified', () => {
      render(
        <IndexingModeSection
          {...defaultProps}
          hasSetIndexType
          indexType={IndexingType.QUALIFIED}
        />,
      )
      expect(screen.getByText(`${ns}.stepTwo.qualified`))!.toBeInTheDocument()
      expect(screen.queryByText(`${ns}.stepTwo.economical`)).not.toBeInTheDocument()
    })

    it('should only show economical option when hasSetIndexType and type is economical', () => {
      render(
        <IndexingModeSection
          {...defaultProps}
          hasSetIndexType
          indexType={IndexingType.ECONOMICAL}
        />,
      )
      expect(screen.getByText(`${ns}.stepTwo.economical`))!.toBeInTheDocument()
      expect(screen.queryByText(`${ns}.stepTwo.qualified`)).not.toBeInTheDocument()
    })
  })

  describe('Index Type Switching', () => {
    it('exposes mutually exclusive indexing choices and switches them with arrow keys', async () => {
      const user = userEvent.setup()
      const Harness = () => {
        const [indexType, setIndexType] = useState<IndexingType>(IndexingType.QUALIFIED)
        return (
          <IndexingModeSection
            {...defaultProps}
            indexType={indexType}
            onIndexTypeChange={setIndexType}
          />
        )
      }
      render(<Harness />)
      const group = screen.getByRole('radiogroup', { name: `${ns}.stepTwo.indexMode` })
      const qualified = within(group).getByRole('radio', { name: /stepTwo.qualified/ })
      const economical = within(group).getByRole('radio', { name: `${ns}.stepTwo.economical` })
      expect(qualified).toBeChecked()
      qualified.focus()
      await user.keyboard('{ArrowDown}')
      expect(economical).toBeChecked()
      expect(qualified).not.toBeChecked()
      await user.keyboard('{ArrowUp}')
      expect(qualified).toBeChecked()
      expect(economical).not.toBeChecked()
    })

    it('should disable economical when docForm is QA', () => {
      render(<IndexingModeSection {...defaultProps} docForm={ChunkingMode.qa} />)
      const card = screen.getByRole('radio', { name: `${ns}.stepTwo.economical` })
      expect(card).toBeDisabled()
      expect(screen.getByText(`${ns}.stepTwo.notAvailableForQA`))!.toBeInTheDocument()
    })

    it('should show parent-child disabled reason inline on economical option', () => {
      render(<IndexingModeSection {...defaultProps} docForm={ChunkingMode.parentChild} />)

      expect(screen.getByText(`${ns}.stepTwo.notAvailableForParentChild`)).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: `${ns}.stepTwo.economical` })).toBeDisabled()
    })
  })

  describe('QA Confirm Dialog', () => {
    it('should call onQAConfirmDialogClose when cancel clicked', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(
        <IndexingModeSection
          {...defaultProps}
          isQAConfirmDialogOpen
          onQAConfirmDialogClose={onClose}
        />,
      )
      const cancelBtns = screen.getAllByText(`${ns}.stepTwo.cancel`)
      await user.click(cancelBtns[0]!)
      expect(onClose).toHaveBeenCalled()
    })

    it('should call onQAConfirmDialogConfirm when confirm clicked', async () => {
      const user = userEvent.setup()
      const onConfirm = vi.fn()
      render(
        <IndexingModeSection
          {...defaultProps}
          isQAConfirmDialogOpen
          onQAConfirmDialogConfirm={onConfirm}
        />,
      )
      await user.click(screen.getByText(`${ns}.stepTwo.switch`))
      expect(onConfirm).toHaveBeenCalled()
    })
  })

  describe('Dataset Settings Link', () => {
    it('should show settings link when economical and hasSetIndexType', () => {
      render(
        <IndexingModeSection
          {...defaultProps}
          hasSetIndexType
          indexType={IndexingType.ECONOMICAL}
          datasetId="ds-123"
        />,
      )
      expect(screen.getByText(`${ns}.stepTwo.datasetSettingLink`))!.toBeInTheDocument()
      expect(screen.getByText(`${ns}.stepTwo.datasetSettingLink`).closest('a'))!.toHaveAttribute(
        'href',
        '/datasets/ds-123/settings',
      )
    })
  })
})
