import type * as React from 'react'
import type { MockedFunction } from 'vitest'
import type { IndexingType } from '@/app/components/datasets/create/step-two'
import type { DataSet } from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { ChunkingMode, DatasetPermission, DataSourceType } from '@/models/datasets'
import { RETRIEVE_METHOD } from '@/types/app'
import Item from './index'

vi.mock('../settings-modal', () => ({
  default: ({ onSave, onCancel, currentDataset }: any) => (
    <div>
      <div>Mock settings modal</div>
      <button onClick={() => onSave({ ...currentDataset, name: 'Updated dataset' })}>Save changes</button>
      <button onClick={onCancel}>Close</button>
    </div>
  ),
}))

vi.mock('@/hooks/use-breakpoints', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-breakpoints')>()
  return {
    ...actual,
    default: vi.fn(() => actual.MediaType.pc),
  }
})

const mockedUseBreakpoints = useBreakpoints as MockedFunction<typeof useBreakpoints>

const baseRetrievalConfig: RetrievalConfig = {
  search_method: RETRIEVE_METHOD.semantic,
  reranking_enable: false,
  reranking_model: {
    reranking_provider_name: 'provider',
    reranking_model_name: 'rerank-model',
  },
  top_k: 4,
  score_threshold_enabled: false,
  score_threshold: 0,
}

const defaultIndexingTechnique: IndexingType = 'high_quality' as IndexingType

const createDataset = (overrides: Partial<DataSet> = {}): DataSet => {
  const {
    retrieval_model,
    retrieval_model_dict,
    icon_info,
    ...restOverrides
  } = overrides

  const resolvedRetrievalModelDict = {
    ...baseRetrievalConfig,
    ...retrieval_model_dict,
  }
  const resolvedRetrievalModel = {
    ...baseRetrievalConfig,
    ...(retrieval_model ?? retrieval_model_dict),
  }

  const defaultIconInfo = {
    icon: '📘',
    icon_type: 'emoji',
    icon_background: '#FFEAD5',
    icon_url: '',
  }

  const resolvedIconInfo = ('icon_info' in overrides)
    ? icon_info
    : defaultIconInfo

  return {
    id: 'dataset-id',
    name: 'Dataset Name',
    indexing_status: 'completed',
    icon_info: resolvedIconInfo as DataSet['icon_info'],
    description: 'A test dataset',
    permission: DatasetPermission.onlyMe,
    data_source_type: DataSourceType.FILE,
    indexing_technique: defaultIndexingTechnique,
    author_name: 'author',
    created_by: 'creator',
    updated_by: 'updater',
    updated_at: 0,
    app_count: 0,
    doc_form: ChunkingMode.text,
    document_count: 0,
    total_document_count: 0,
    total_available_documents: 0,
    word_count: 0,
    provider: 'dify',
    embedding_model: 'text-embedding',
    embedding_model_provider: 'openai',
    embedding_available: true,
    retrieval_model_dict: resolvedRetrievalModelDict,
    retrieval_model: resolvedRetrievalModel,
    tags: [],
    external_knowledge_info: {
      external_knowledge_id: 'external-id',
      external_knowledge_api_id: 'api-id',
      external_knowledge_api_name: 'api-name',
      external_knowledge_api_endpoint: 'https://endpoint',
    },
    external_retrieval_model: {
      top_k: 2,
      score_threshold: 0.5,
      score_threshold_enabled: true,
    },
    built_in_field_enabled: true,
    doc_metadata: [],
    keyword_number: 3,
    pipeline_id: 'pipeline-id',
    is_published: true,
    runtime_mode: 'general',
    enable_api: true,
    is_multimodal: false,
    ...restOverrides,
  }
}

const renderItem = (config: DataSet, props?: Partial<React.ComponentProps<typeof Item>>) => {
  const onSave = vi.fn()
  const onRemove = vi.fn()

  render(
    <Item
      config={config}
      onSave={onSave}
      onRemove={onRemove}
      {...props}
    />,
  )

  return { onSave, onRemove }
}

describe('dataset-config/card-item', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedUseBreakpoints.mockReturnValue(MediaType.pc)
  })

  it('should render dataset details with indexing and external badges', () => {
    const dataset = createDataset({
      provider: 'external',
      retrieval_model_dict: {
        ...baseRetrievalConfig,
        search_method: RETRIEVE_METHOD.semantic,
      },
    })

    renderItem(dataset)

    const card = screen.getByText(dataset.name).closest('.group') as HTMLElement
    const actionButtons = within(card).getAllByRole('button', { hidden: true })

    expect(screen.getByText(dataset.name)).toBeInTheDocument()
    expect(screen.getByText('dataset.indexingTechnique.high_quality · dataset.indexingMethod.semantic_search')).toBeInTheDocument()
    expect(screen.getByText('dataset.externalTag')).toBeInTheDocument()
    expect(actionButtons).toHaveLength(2)
  })

  it('should open settings drawer from edit action and close after saving', async () => {
    const user = userEvent.setup()
    const dataset = createDataset()
    const { onSave } = renderItem(dataset)

    const card = screen.getByText(dataset.name).closest('.group') as HTMLElement
    const [editButton] = within(card).getAllByRole('button', { hidden: true })
    await user.click(editButton)

    expect(screen.getByText('Mock settings modal')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeVisible()
    })

    await user.click(screen.getByText('Save changes'))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Updated dataset' }))
    })
    await waitFor(() => {
      expect(screen.queryByText('Mock settings modal')).not.toBeInTheDocument()
    })
  })

  it('should call onRemove and toggle destructive state on hover', async () => {
    const user = userEvent.setup()
    const dataset = createDataset()
    const { onRemove } = renderItem(dataset)

    const card = screen.getByText(dataset.name).closest('.group') as HTMLElement
    const buttons = within(card).getAllByRole('button', { hidden: true })
    const deleteButton = buttons[buttons.length - 1]

    expect(deleteButton.className).not.toContain('action-btn-destructive')

    fireEvent.mouseEnter(deleteButton)
    expect(deleteButton.className).toContain('action-btn-destructive')
    expect(card.className).toContain('border-state-destructive-border')

    fireEvent.mouseLeave(deleteButton)
    expect(deleteButton.className).not.toContain('action-btn-destructive')

    await user.click(deleteButton)
    expect(onRemove).toHaveBeenCalledWith(dataset.id)
  })

  it('should use default icon information when icon details are missing', () => {
    const dataset = createDataset({ icon_info: undefined })

    renderItem(dataset)

    const nameElement = screen.getByText(dataset.name)
    const iconElement = nameElement.parentElement?.firstElementChild as HTMLElement

    expect(iconElement).toHaveStyle({ background: '#FFF4ED' })
    expect(iconElement.querySelector('em-emoji')).toHaveAttribute('id', '📙')
  })

  it('should apply mask overlay on mobile when drawer is open', async () => {
    mockedUseBreakpoints.mockReturnValue(MediaType.mobile)
    const user = userEvent.setup()
    const dataset = createDataset()

    renderItem(dataset)

    const card = screen.getByText(dataset.name).closest('.group') as HTMLElement
    const [editButton] = within(card).getAllByRole('button', { hidden: true })
    await user.click(editButton)
    expect(screen.getByText('Mock settings modal')).toBeInTheDocument()

    const overlay = Array.from(document.querySelectorAll('[class]'))
      .find(element => element.className.toString().includes('bg-black/30'))

    expect(overlay).toBeInTheDocument()
  })
})
