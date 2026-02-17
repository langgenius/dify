import type { DefaultModelResponse } from '../declarations'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { ModelTypeEnum } from '../declarations'
import SystemModel from './index'

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

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    textGenerationModelList: [],
  }),
}))

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: vi.fn(),
  }),
}))

vi.mock('../hooks', () => ({
  useModelList: () => ({
    data: [],
  }),
  useSystemDefaultModelAndModelList: (defaultModel: DefaultModelResponse | undefined) => [
    defaultModel || { model: '', provider: { provider: '', icon_small: { en_US: '', zh_Hans: '' } } },
    vi.fn(),
  ],
  useUpdateModelList: () => vi.fn(),
}))

vi.mock('@/service/common', () => ({
  updateDefaultModel: vi.fn(() => Promise.resolve({ result: 'success' })),
}))

vi.mock('../model-selector', () => ({
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
  })

  it('should render settings button', () => {
    render(<SystemModel {...defaultProps} />)
    expect(screen.getByRole('button', { name: /system model settings/i })).toBeInTheDocument()
  })

  it('should open modal when button is clicked', async () => {
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

  it('should close modal when cancel is clicked', async () => {
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
})
