import type {
  DatasetDetailWithPartialMembersResponse,
  DocumentDetailResponse,
  IndexingEstimateResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { ProviderWithModelsResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { StepTwoFile } from '../types'
import type { RetrievalConfig } from '@/types/app'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ConfigurationMethodEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { ChunkingMode, DataSourceType, ProcessMode } from '@/models/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { RETRIEVE_METHOD } from '@/types/app'
import StepTwo from '../index'

vi.mock('@/hooks/use-breakpoints', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-breakpoints')>()
  return { ...actual, default: vi.fn(() => actual.MediaType.pc) }
})

const mockDataset: Pick<
  DatasetDetailWithPartialMembersResponse,
  | 'id'
  | 'doc_form'
  | 'data_source_type'
  | 'embedding_model'
  | 'embedding_model_provider'
  | 'retrieval_model_dict'
> = {
  id: 'test-dataset-id',
  doc_form: ChunkingMode.text,
  data_source_type: DataSourceType.FILE,
  embedding_model: 'text-embedding-ada-002',
  embedding_model_provider: 'openai',
  retrieval_model_dict: {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0.5,
  } as RetrievalConfig,
}

let mockCurrentDataset: typeof mockDataset | null = null
const mockMutateDatasetRes = vi.fn()

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: {
      dataset: typeof mockDataset | null
      mutateDatasetRes: () => void
    }) => unknown,
  ) => selector({ dataset: mockCurrentDataset, mutateDatasetRes: mockMutateDatasetRes }),
}))

const mockEmbeddingModelList = [
  { provider: 'openai', models: [{ model: 'text-embedding-ada-002', features: [] }] },
  { provider: 'cohere', models: [{ model: 'embed-english-v3.0', features: [] }] },
]
const mockDefaultEmbeddingModel = {
  provider: { provider: 'openai' },
  model: 'text-embedding-ada-002',
}
// Model[] type structure for rerank model list (simplified mock)
const mockRerankModelList: ProviderWithModelsResponse[] = [
  {
    tenant_id: 'test-workspace',
    provider: 'cohere',
    icon_small: { en_US: 'cohere-icon', zh_Hans: 'cohere-icon' },
    label: { en_US: 'Cohere', zh_Hans: 'Cohere' },
    models: [
      {
        model: 'rerank-english-v3.0',
        label: { en_US: 'Rerank English v3.0', zh_Hans: 'Rerank English v3.0' },
        model_type: ModelTypeEnum.rerank,
        features: [],
        fetch_from: ConfigurationMethodEnum.predefinedModel,
        status: ModelStatusEnum.active,
        model_properties: {},
        load_balancing_enabled: false,
      },
    ],
    status: ModelStatusEnum.active,
  },
]
const mockRerankDefaultModel = { provider: { provider: 'cohere' }, model: 'rerank-english-v3.0' }
const mockIsRerankDefaultModelValid = true

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    modelList: mockRerankModelList,
    defaultModel: mockRerankDefaultModel,
    currentModel: mockIsRerankDefaultModelValid,
  }),

  useDefaultModel: () => ({ data: mockDefaultEmbeddingModel }),
}))

const mockCreate = vi.fn()
const mockEstimate = vi.fn()

const mockFetchDefaultProcessRuleMutate = vi.fn(() =>
  Promise.resolve({
    mode: 'custom',
    rules: {
      segmentation: { separator: '\\n', max_tokens: 500, chunk_overlap: 50 },
      pre_processing_rules: [
        { id: 'remove_extra_spaces', enabled: true },
        { id: 'remove_urls_emails', enabled: false },
      ],
      parent_mode: 'paragraph',
      subchunk_segmentation: { separator: '\\n', max_tokens: 256 },
    },
    limits: { indexing_max_segmentation_tokens_length: 4000 },
  }),
)
// Mock amplitude tracking (external service)
vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

// Mock complex child components to avoid deep dependency chains when rendering StepTwo
vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  ModelSelector: ({
    onValueChange,
    disabled,
  }: {
    onValueChange?: (val: Record<string, string>) => void
    disabled?: boolean
  }) => (
    <div data-testid="model-selector" data-disabled={disabled}>
      <button
        onClick={() => onValueChange?.({ provider: 'openai', model: 'text-embedding-3-small' })}
      >
        Select Model
      </button>
    </div>
  ),
}))

vi.mock('@/app/components/datasets/common/retrieval-method-config', () => ({
  default: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="retrieval-method-config" data-disabled={disabled}>
      Retrieval Config
    </div>
  ),
}))

vi.mock('@/app/components/datasets/common/economical-retrieval-method-config', () => ({
  default: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="economical-retrieval-config" data-disabled={disabled}>
      Economical Config
    </div>
  ),
}))

const createMockFile = (overrides: Partial<StepTwoFile> = {}): StepTwoFile => ({
  id: 'file-1',
  name: 'test-file.pdf',
  extension: 'pdf',
  ...overrides,
})

const createMockDocumentDetail = (
  overrides?: Partial<DocumentDetailResponse>,
): DocumentDetailResponse =>
  ({
    id: 'doc-1',
    doc_form: ChunkingMode.text,
    doc_language: 'English',
    dataset_process_rule: {
      mode: ProcessMode.general,
      rules: {
        segmentation: { separator: '\\n\\n', max_tokens: 1024, chunk_overlap: 50 },
        pre_processing_rules: [{ id: 'remove_extra_spaces', enabled: true }],
      },
    },
    ...overrides,
  }) as DocumentDetailResponse

const createMockEstimate = (
  overrides?: Partial<IndexingEstimateResponse>,
): IndexingEstimateResponse => ({
  total_segments: 10,
  tokens: 5000,
  total_price: 0.01,
  currency: 'USD',
  qa_preview: [{ question: 'Q1', answer: 'A1' }],
  preview: [{ content: 'Chunk 1 content', child_chunks: ['Child 1', 'Child 2'] }],
  ...overrides,
})

describe('StepTwo Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCurrentDataset = null
    mockCreate.mockResolvedValue({
      batch: 'batch-1',
      dataset: { id: 'new-dataset-id', name: 'Knowledge' },
      documents: [],
    })
    mockEstimate.mockResolvedValue(createMockEstimate())
  })

  afterEach(() => {
    cleanup()
  })

  const defaultStepTwoProps = {
    dataSourceType: DataSourceType.FILE,
    files: [createMockFile()],
    isAPIKeySet: true,
    onSetting: vi.fn(),
    notionCredentialId: '',
    onStepChange: vi.fn(),
  }

  describe('Rendering', () => {
    it('switches chunking modes as one radio group without nesting parameter controls in a radio', async () => {
      const user = userEvent.setup()
      render(<StepTwo {...defaultStepTwoProps} />)
      const group = screen.getByRole('radiogroup', { name: 'datasetCreation.stepTwo.segmentation' })
      const general = within(group).getByRole('radio', { name: 'datasetCreation.stepTwo.general' })
      const parentChild = within(group).getByRole('radio', {
        name: 'datasetCreation.stepTwo.parentChild',
      })
      expect(general).toBeChecked()
      expect(general).not.toContainElement(
        screen.getByRole('button', { name: 'datasetCreation.stepTwo.previewChunk' }),
      )
      general.focus()
      await user.keyboard('{ArrowDown}')
      expect(parentChild).toBeChecked()
      expect(general).not.toBeChecked()
      expect(parentChild).not.toContainElement(
        screen.getByRole('button', { name: 'datasetCreation.stepTwo.previewChunk' }),
      )
      await user.keyboard(' ')
      expect(parentChild).toBeChecked()
      await user.keyboard('{ArrowUp}')
      expect(general).toBeChecked()
      expect(parentChild).not.toBeChecked()
    })

    it.each(['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'])(
      'keeps General selected and its preview intact when editing the delimiter with %s',
      async (key) => {
        const user = userEvent.setup()
        render(<StepTwo {...defaultStepTwoProps} />)
        await user.click(
          screen.getByRole('button', { name: 'datasetCreation.stepTwo.previewChunk' }),
        )
        expect(await screen.findByText('Chunk 1 content')).toBeInTheDocument()
        const input = screen.getByRole('textbox', { name: 'datasetCreation.stepTwo.separator' })
        await user.click(input)
        await user.keyboard(key === 'ArrowLeft' ? '{Home}' : '{End}')
        await user.keyboard(`{${key}}`)

        expect(screen.getByRole('radio', { name: 'datasetCreation.stepTwo.general' })).toBeChecked()
        expect(
          screen.getByRole('radio', { name: 'datasetCreation.stepTwo.parentChild' }),
        ).not.toBeChecked()
        expect(input).toBeInTheDocument()
        expect(input).toHaveFocus()
        expect(screen.getByText('Chunk 1 content')).toBeInTheDocument()
      },
    )
  })

  describe('Initialization', () => {
    it('should apply config from rules when in setting mode with document detail', () => {
      mockCurrentDataset = mockDataset
      const docDetail = createMockDocumentDetail()
      docDetail.dataset_process_rule!.mode = 'custom'
      render(
        <StepTwo
          {...defaultStepTwoProps}
          isSetting={true}
          documentDetail={docDetail}
          datasetId="test-id"
        />,
      )
      // Should not fetch default rule when isSetting
      expect(mockFetchDefaultProcessRuleMutate).not.toHaveBeenCalled()
      expect(
        screen.getByRole('textbox', { name: 'datasetCreation.stepTwo.maxLength' }),
      ).toHaveValue('1,024')
    })
  })

  describe('User Interactions', () => {
    it('should call onStepChange(-1) when Previous button is clicked', async () => {
      const onStepChange = vi.fn()
      render(<StepTwo {...defaultStepTwoProps} onStepChange={onStepChange} />)
      await userEvent.setup().click(screen.getByText(/stepTwo\.previousStep/i))
      expect(onStepChange).toHaveBeenCalledWith(-1)
    })

    it('should trigger handleCreate when Next Step button is clicked', async () => {
      const onStepChange = vi.fn()
      render(<StepTwo {...defaultStepTwoProps} onStepChange={onStepChange} />)
      await waitFor(() =>
        expect(
          screen.getByRole('textbox', { name: 'datasetCreation.stepTwo.maxLength' }),
        ).toHaveValue('500'),
      )
      await act(async () => {
        await userEvent.setup().click(screen.getByText(/stepTwo\.nextStep/i))
      })
      // handleCreate validates, builds params, and calls executeCreation
      // which calls onStepChange(1) on success
      expect(onStepChange).toHaveBeenCalledExactlyOnceWith(1)
      expect(mockCreate).toHaveBeenCalledExactlyOnceWith({
        body: expect.objectContaining({
          data_source: {
            type: DataSourceType.FILE,
            info_list: {
              data_source_type: DataSourceType.FILE,
              file_info_list: { file_ids: ['file-1'] },
            },
          },
          doc_form: ChunkingMode.text,
          indexing_technique: 'high_quality',
          embedding_model: 'text-embedding-ada-002',
          process_rule: {
            mode: ProcessMode.general,
            rules: {
              segmentation: { separator: '\n', max_tokens: 500, chunk_overlap: 50 },
              pre_processing_rules: [
                { id: 'remove_extra_spaces', enabled: true },
                { id: 'remove_urls_emails', enabled: false },
              ],
            },
          },
        }),
      })
    })

    it('opens the mobile preview on request and restores focus to its button after closing', async () => {
      vi.mocked(useBreakpoints).mockReturnValue(MediaType.mobile)
      try {
        const user = userEvent.setup()
        render(<StepTwo {...defaultStepTwoProps} />)
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        const trigger = screen.getByRole('button', { name: 'datasetCreation.stepTwo.previewChunk' })
        await user.click(trigger)
        const drawer = await screen.findByRole('dialog', {
          name: 'datasetCreation.stepTwo.preview',
        })
        await user.click(within(drawer).getByRole('button', { name: 'common.operation.close' }))
        await waitFor(() => {
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
          expect(trigger).toHaveFocus()
        })
      } finally {
        vi.mocked(useBreakpoints).mockReturnValue(MediaType.pc)
      }
    })
  })

  describe('Conditional Rendering', () => {
    it('should call onCancel when Cancel button is clicked in setting mode', async () => {
      const onCancel = vi.fn()
      const docDetail = createMockDocumentDetail()
      render(
        <StepTwo
          {...defaultStepTwoProps}
          isSetting={true}
          documentDetail={docDetail}
          datasetId="test-id"
          onCancel={onCancel}
        />,
      )
      await userEvent.setup().click(screen.getByText(/stepTwo\.cancel/i))
      expect(onCancel).toHaveBeenCalled()
    })

    it('should trigger handleCreate (Save) in setting mode', async () => {
      const onSave = vi.fn()
      const docDetail = createMockDocumentDetail()
      render(
        <StepTwo
          {...defaultStepTwoProps}
          isSetting={true}
          documentDetail={docDetail}
          datasetId="test-id"
          onSave={onSave}
        />,
      )
      await act(async () => {
        await userEvent.setup().click(screen.getByText(/stepTwo\.save/i))
      })
      // handleCreate → validateParams → buildCreationParams → executeCreation → onSave
      expect(onSave).toHaveBeenCalledOnce()
      expect(mockCreate).toHaveBeenCalledExactlyOnceWith({
        params: { dataset_id: 'test-id' },
        body: expect.objectContaining({
          original_document_id: 'doc-1',
          doc_form: ChunkingMode.text,
          process_rule: expect.objectContaining({
            rules: expect.objectContaining({
              segmentation: { separator: '\n\n', max_tokens: 1024, chunk_overlap: 50 },
            }),
          }),
        }),
      })
    })

    it('should only show parent-child option when dataset has parentChild doc_form', () => {
      mockCurrentDataset = { ...mockDataset, doc_form: ChunkingMode.parentChild }
      render(<StepTwo {...defaultStepTwoProps} datasetId="test-id" />)
      // showGeneralOption should be false (parentChild not in [text, qa])
      // showParentChildOption should be true
      // showGeneralOption should be false (parentChild not in [text, qa])
      // showParentChildOption should be true
      expect(screen.getByText('datasetCreation.stepTwo.parentChild')).toBeInTheDocument()
      expect(
        screen.queryByRole('radio', { name: 'datasetCreation.stepTwo.general' }),
      ).not.toBeInTheDocument()
    })

    it('should show general option only when dataset has text doc_form', () => {
      mockCurrentDataset = { ...mockDataset, doc_form: ChunkingMode.text }
      render(<StepTwo {...defaultStepTwoProps} datasetId="test-id" />)
      // showGeneralOption should be true (text is in [text, qa])
      // showGeneralOption should be true (text is in [text, qa])
      expect(screen.getByText('datasetCreation.stepTwo.general')).toBeInTheDocument()
      expect(
        screen.queryByRole('radio', { name: 'datasetCreation.stepTwo.parentChild' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('Upload in Dataset', () => {
    it('should show both options in empty dataset upload', () => {
      // oxlint-disable-next-line typescript/no-explicit-any
      mockCurrentDataset = { ...mockDataset, doc_form: undefined as any }
      render(<StepTwo {...defaultStepTwoProps} datasetId="test-id" />)
      // isUploadInEmptyDataset=true shows both options
      // isUploadInEmptyDataset=true shows both options
      expect(screen.getByText('datasetCreation.stepTwo.general'))!.toBeInTheDocument()
      expect(screen.getByText('datasetCreation.stepTwo.parentChild'))!.toBeInTheDocument()
    })
  })

  describe('Indexing Mode', () => {
    it('should disable model and retrieval config when datasetId has existing data source', () => {
      mockCurrentDataset = { ...mockDataset, data_source_type: DataSourceType.FILE }
      render(<StepTwo {...defaultStepTwoProps} datasetId="test-id" />)
      // isModelAndRetrievalConfigDisabled should be true
      const modelSelector = screen.getByTestId('model-selector')
      expect(modelSelector)!.toHaveAttribute('data-disabled', 'true')
    })
  })

  describe('Indexing mode transitions', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockCurrentDataset = null
    })

    afterEach(() => {
      cleanup()
    })

    it('should switch to QUALIFIED when selecting parentChild in ECONOMICAL mode', async () => {
      render(<StepTwo {...defaultStepTwoProps} isAPIKeySet={false} />)
      await vi.waitFor(() => {
        expect(screen.getByText(/stepTwo\.segmentation/i))!.toBeInTheDocument()
      })
      const parentChildTitles = screen.getAllByText(/stepTwo\.parentChild/i)
      await userEvent.setup().click(parentChildTitles[0]!)
      expect(screen.getByRole('radio', { name: /stepTwo.qualified/ })).toBeChecked()
      expect(
        screen.getByRole('radio', { name: 'datasetCreation.stepTwo.parentChild' }),
      ).toBeChecked()
    })

    it('should open QA confirm dialog and confirm switch when QA selected in ECONOMICAL mode', async () => {
      render(<StepTwo {...defaultStepTwoProps} isAPIKeySet={false} />)
      await vi.waitFor(() => {
        expect(screen.getByText(/stepTwo\.segmentation/i))!.toBeInTheDocument()
      })
      const qaCheckbox = screen.getByText(/stepTwo\.useQALanguage/i)
      await userEvent.setup().click(qaCheckbox)
      // Dialog should open → click Switch to confirm (triggers handleQAConfirm)
      const switchButton = await screen.findByText(/stepTwo\.switch/i)
      expect(switchButton)!.toBeInTheDocument()
      await userEvent.setup().click(switchButton)
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(screen.getByRole('radio', { name: /stepTwo.qualified/ })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: /stepTwo.useQALanguage/ })).toBeChecked()
    })

    it('should close QA confirm dialog when cancel is clicked', async () => {
      render(<StepTwo {...defaultStepTwoProps} isAPIKeySet={false} />)
      await vi.waitFor(() => {
        expect(screen.getByText(/stepTwo\.segmentation/i))!.toBeInTheDocument()
      })
      // Open QA confirm dialog
      const qaCheckbox = screen.getByText(/stepTwo\.useQALanguage/i)
      await userEvent.setup().click(qaCheckbox)
      const dialogCancelButtons = await screen.findAllByText(/stepTwo\.cancel/i)
      await userEvent.setup().click(dialogCancelButtons[0]!)
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(
        screen.getByRole('radio', { name: 'datasetCreation.stepTwo.economical' }),
      ).toBeChecked()
      expect(screen.getByRole('checkbox', { name: /stepTwo.useQALanguage/ })).not.toBeChecked()
    })
  })
})

// Embedding catalog is fixed form metadata; requests owned by step two use real mutations.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'workspaces.current.models.modelTypes.byModelType.get': () => ({
      data: mockEmbeddingModelList,
    }),
  })
})
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.processRule.get': () => mockFetchDefaultProcessRuleMutate(),
      'datasets.indexingEstimate.post': (input) => mockEstimate(input),
      'datasets.init.post': (input) => mockCreate(input),
      'datasets.byDatasetId.documents.post': (input) => mockCreate(input),
    }),
  }
})
