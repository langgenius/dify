import type { DefaultModelResponse } from '../../declarations'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { ModelTypeEnum } from '../../declarations'
import SystemModel from '../index'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'modelProvider.systemModelSettings': 'System Model Settings',
    'modelProvider.systemReasoningModel.key': 'System Reasoning Model',
    'modelProvider.systemReasoningModel.tip': 'Reasoning model tip',
    'modelProvider.embeddingModel.key': 'Embedding Model',
    'modelProvider.embeddingModel.tip': 'Embedding model tip',
    'modelProvider.rerankModel.key': 'Rerank Model',
    'modelProvider.rerankModel.tip': 'Rerank model tip',
    'modelProvider.speechToTextModel.key': 'Speech to Text Model',
    'modelProvider.speechToTextModel.tip': 'Speech to text model tip',
    'modelProvider.ttsModel.key': 'TTS Model',
    'modelProvider.ttsModel.tip': 'TTS model tip',
    'operation.cancel': 'Cancel',
    'operation.save': 'Save',
    'actionMsg.modifiedSuccessfully': 'Modified successfully',
  })
})

const mockToastSuccess = vi.hoisted(() => vi.fn())
const mockUpdateModelList = vi.hoisted(() => vi.fn())
const mockInvalidateDefaultModel = vi.hoisted(() => vi.fn())
const mockUpdateDefaultModel = vi.hoisted(() => vi.fn(() => Promise.resolve({ result: 'success' })))

let mockIsCurrentWorkspaceManager = true

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    textGenerationModelList: [],
  }),
}))

vi.mock('@/app/components/base/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/base/ui/toast')>()
  return {
    ...actual,
    toast: {
      ...actual.toast,
      success: mockToastSuccess,
    },
  }
})

vi.mock('../../hooks', () => ({
  useModelList: () => ({
    data: [],
  }),
  useSystemDefaultModelAndModelList: (defaultModel: DefaultModelResponse | undefined) => [
    defaultModel || { model: '', provider: { provider: '', icon_small: { en_US: '', zh_Hans: '' } } },
    vi.fn(),
  ],
  useUpdateModelList: () => mockUpdateModelList,
  useInvalidateDefaultModel: () => mockInvalidateDefaultModel,
}))

vi.mock('@/service/common', () => ({
  updateDefaultModel: mockUpdateDefaultModel,
}))

vi.mock('../../model-selector', () => ({
  default: ({ onSelect }: { onSelect: (model: { model: string, provider: string }) => void }) => (
    <button onClick={() => onSelect({ model: 'test', provider: 'test' })}>Mock Model Selector</button>
  ),
}))

const mockModel: DefaultModelResponse = {
  model: 'gpt-4',
  model_type: ModelTypeEnum.textGeneration,
  provider: {
    provider: 'openai',
    icon_small: { en_US: '', zh_Hans: '' },
  },
}

const defaultProps = {
  textGenerationDefaultModel: mockModel,
  embeddingsDefaultModel: undefined,
  rerankDefaultModel: undefined,
  speech2textDefaultModel: undefined,
  ttsDefaultModel: undefined,
  notConfigured: false,
  isLoading: false,
}

describe('SystemModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceManager = true
  })

  it('should render settings button', () => {
    render(<SystemModel {...defaultProps} />)
    expect(screen.getByRole('button', { name: /system model settings/i })).toBeInTheDocument()
  })

  it('should open dialog when button is clicked', async () => {
    render(<SystemModel {...defaultProps} />)
    const button = screen.getByRole('button', { name: /system model settings/i })
    fireEvent.click(button)
    await waitFor(() => {
      expect(screen.getByText(/system reasoning model/i)).toBeInTheDocument()
    })
  })

  it('should disable button when loading', () => {
    render(<SystemModel {...defaultProps} isLoading />)
    expect(screen.getByRole('button', { name: /system model settings/i })).toBeDisabled()
  })

  it('should render the primary button variant when configuration is required', () => {
    render(<SystemModel {...defaultProps} notConfigured />)

    expect(screen.getByRole('button', { name: /system model settings/i })).toHaveClass('btn-primary')
  })

  it('should close dialog when cancel is clicked', async () => {
    render(<SystemModel {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /system model settings/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
    })
  })

  it('should save selected models and show success feedback', async () => {
    render(<SystemModel {...defaultProps} />)

    fireEvent.click(screen.getByRole('button', { name: /system model settings/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    })

    const selectorButtons = screen.getAllByRole('button', { name: 'Mock Model Selector' })
    selectorButtons.forEach(button => fireEvent.click(button))

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(mockUpdateDefaultModel).toHaveBeenCalledTimes(1)
      expect(mockToastSuccess).toHaveBeenCalledWith('Modified successfully')
      expect(mockInvalidateDefaultModel).toHaveBeenCalledTimes(5)
      expect(mockUpdateModelList).toHaveBeenCalledTimes(5)
    })
  })

  it('should keep the dialog open when saving does not succeed', async () => {
    mockUpdateDefaultModel.mockResolvedValueOnce({ result: 'failed' })

    render(<SystemModel {...defaultProps} />)

    fireEvent.click(screen.getByRole('button', { name: /system model settings/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(mockUpdateDefaultModel).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockInvalidateDefaultModel).not.toHaveBeenCalled()
    expect(mockUpdateModelList).not.toHaveBeenCalled()
  })

  it('should disable save when user is not workspace manager', async () => {
    mockIsCurrentWorkspaceManager = false
    render(<SystemModel {...defaultProps} />)

    fireEvent.click(screen.getByRole('button', { name: /system model settings/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
    })
  })
})
