import type { DefaultModelResponse } from '../../declarations'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { ToastContext } from '@/app/components/base/toast/context'
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

const mockNotify = vi.hoisted(() => vi.fn())
const mockUpdateModelList = vi.hoisted(() => vi.fn())
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

vi.mock('@/app/components/base/toast/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/base/toast/context')>()
  return {
    ...actual,
    useToastContext: () => ({
      notify: mockNotify,
    }),
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
  const renderSystemModel = (props: typeof defaultProps) => render(
    <ToastContext.Provider value={{ notify: mockNotify, close: vi.fn() }}>
      <SystemModel {...props} />
    </ToastContext.Provider>,
  )

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceManager = true
  })

  it('should render settings button', () => {
    renderSystemModel(defaultProps)
    expect(screen.getByRole('button', { name: /system model settings/i })).toBeInTheDocument()
  })

  it('should open modal when button is clicked', async () => {
    renderSystemModel(defaultProps)
    const button = screen.getByRole('button', { name: /system model settings/i })
    fireEvent.click(button)
    await waitFor(() => {
      expect(screen.getByText(/system reasoning model/i)).toBeInTheDocument()
    })
  })

  it('should disable button when loading', () => {
    renderSystemModel({ ...defaultProps, isLoading: true })
    expect(screen.getByRole('button', { name: /system model settings/i })).toBeDisabled()
  })

  it('should close modal when cancel is clicked', async () => {
    renderSystemModel(defaultProps)
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
    renderSystemModel(defaultProps)

    fireEvent.click(screen.getByRole('button', { name: /system model settings/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    })

    const selectorButtons = screen.getAllByRole('button', { name: 'Mock Model Selector' })
    selectorButtons.forEach(button => fireEvent.click(button))

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(mockUpdateDefaultModel).toHaveBeenCalledTimes(1)
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'success',
        message: 'Modified successfully',
      })
      expect(mockUpdateModelList).toHaveBeenCalledTimes(5)
    })
  })

  it('should disable save when user is not workspace manager', async () => {
    mockIsCurrentWorkspaceManager = false
    renderSystemModel(defaultProps)

    fireEvent.click(screen.getByRole('button', { name: /system model settings/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
    })
  })

  it('should render primary variant button when notConfigured is true', () => {
    renderSystemModel({ ...defaultProps, notConfigured: true })
    const button = screen.getByRole('button', { name: /system model settings/i })
    expect(button.className).toContain('btn-primary')
  })

  it('should keep modal open when save returns non-success result', async () => {
    mockUpdateDefaultModel.mockResolvedValueOnce({ result: 'error' })
    renderSystemModel(defaultProps)

    fireEvent.click(screen.getByRole('button', { name: /system model settings/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    })

    const selectorButtons = screen.getAllByRole('button', { name: 'Mock Model Selector' })
    selectorButtons.forEach(button => fireEvent.click(button))

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(mockUpdateDefaultModel).toHaveBeenCalledTimes(1)
      expect(mockNotify).not.toHaveBeenCalled()
    })

    // Modal should still be open after failed save
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('should not add duplicate model type to changedModelTypes when same type is selected twice', async () => {
    renderSystemModel(defaultProps)

    fireEvent.click(screen.getByRole('button', { name: /system model settings/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    })

    // Click the first selector twice (textGeneration type)
    const selectorButtons = screen.getAllByRole('button', { name: 'Mock Model Selector' })
    fireEvent.click(selectorButtons[0])
    fireEvent.click(selectorButtons[0])

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(mockUpdateDefaultModel).toHaveBeenCalledTimes(1)
      // textGeneration was changed, so updateModelList is called once for it
      expect(mockUpdateModelList).toHaveBeenCalledTimes(1)
    })
  })

  it('should call updateModelList for speech2text and tts types on save', async () => {
    renderSystemModel(defaultProps)

    fireEvent.click(screen.getByRole('button', { name: /system model settings/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    })

    // Click speech2text (index 3) and tts (index 4) selectors
    const selectorButtons = screen.getAllByRole('button', { name: 'Mock Model Selector' })
    fireEvent.click(selectorButtons[3])
    fireEvent.click(selectorButtons[4])

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(mockUpdateModelList).toHaveBeenCalledTimes(2)
    })
  })

  it('should call updateModelList for each unique changed model type on save', async () => {
    renderSystemModel(defaultProps)

    fireEvent.click(screen.getByRole('button', { name: /system model settings/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    })

    // Click embedding and rerank selectors (indices 1 and 2)
    const selectorButtons = screen.getAllByRole('button', { name: 'Mock Model Selector' })
    fireEvent.click(selectorButtons[1])
    fireEvent.click(selectorButtons[2])

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(mockUpdateModelList).toHaveBeenCalledTimes(2)
    })
  })
})
