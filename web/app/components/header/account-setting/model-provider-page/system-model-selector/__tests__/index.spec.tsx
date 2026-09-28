import type { DefaultModelResponse } from '../../declarations'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { renderWithNuqs as render } from '@/test/nuqs-testing'
import { ModelTypeEnum } from '../../declarations'
import SystemModel from '../index'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'modelProvider.systemModelSettings': 'System Model Settings',
    'modelProvider.systemModelSettingsDesc': 'Set default models.',
    'modelProvider.systemModelSettingsTitle': 'Default Model Settings',
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
    'operation.reset': 'Reset',
    loading: 'Loading',
    'actionMsg.modifiedSuccessfully': 'Modified successfully',
  })
})

const mockToastSuccess = vi.hoisted(() => vi.fn())
const mockUpdateModelList = vi.hoisted(() => vi.fn())
const mockInvalidateDefaultModel = vi.hoisted(() => vi.fn())
const mockUpdateDefaultModel = vi.hoisted(() => vi.fn(() => Promise.resolve({ result: 'success' })))
const mockModelListQuery = vi.hoisted(() => vi.fn())
const mockModelSelectorProps = vi.hoisted(
  () =>
    [] as Array<{
      hideProviderSettingsFooter?: boolean
      onConfigureEmptyState?: () => void
      showModelMeta?: boolean
    }>,
)

let mockWorkspacePermissionKeys = ['plugin.model_config']

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})

vi.mock('@/app/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/notifications')>()
  return {
    ...actual,
    toast: {
      ...actual.toast,
      success: mockToastSuccess,
    },
  }
})

vi.mock('../../hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks')>()
  return {
    ...actual,
    useUpdateModelList: () => mockUpdateModelList,
    useInvalidateDefaultModel: () => mockInvalidateDefaultModel,
  }
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    ...actual,
    consoleClient: {
      workspaces: {
        current: {
          defaultModel: { post: mockUpdateDefaultModel },
        },
      },
    },
  }
})

vi.mock('../../model-selector', () => ({
  ModelSelector: (props: {
    hideProviderSettingsFooter?: boolean
    onConfigureEmptyState?: () => void
    showModelMeta?: boolean
    value?: { model: string; provider: string }
    onClear?: () => void
    clearLabel?: string
    disabled?: boolean
    onValueChange: (model: { model: string; provider: string }) => void
  }) => {
    mockModelSelectorProps.push(props)
    return (
      <div>
        <output>{props.value?.model ?? 'No model selected'}</output>
        {props.value && props.onClear && (
          <button
            type="button"
            aria-label={props.clearLabel}
            disabled={props.disabled}
            onClick={props.onClear}
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={() => props.onValueChange({ model: 'test', provider: 'test' })}
        >
          Mock Model Selector
        </button>
        {props.onConfigureEmptyState && (
          <button type="button" onClick={props.onConfigureEmptyState}>
            Mock Configure Empty State
          </button>
        )}
      </div>
    )
  },
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
  isPending: false,
}

describe('SystemModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockModelListQuery.mockReturnValue({ data: [], isPending: false })
    mockModelSelectorProps.length = 0
    mockWorkspacePermissionKeys = ['plugin.model_config']
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

  it('opens the dialog from URL state', async () => {
    render(<SystemModel {...defaultProps} />, { searchParams: '?dialog=system-models' })

    expect(await screen.findByRole('button', { name: /save/i })).toBeInTheDocument()
    expect(mockModelListQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
          input: { params: { model_type: ModelTypeEnum.textEmbedding } },
        }),
        enabled: true,
      }),
    )
  })

  it('clears only the dialog URL state when closed', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = render(<SystemModel {...defaultProps} />, {
      searchParams: '?dialog=system-models&source=goto-anything',
    })

    await user.click(await screen.findByRole('button', { name: /cancel/i }))

    expect(onUrlUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ queryString: '?source=goto-anything' }),
    )
  })

  it('loads non-text model lists only after the dialog opens', async () => {
    const user = userEvent.setup()
    render(<SystemModel {...defaultProps} />)

    expect(mockModelListQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
          input: { params: { model_type: ModelTypeEnum.textEmbedding } },
        }),
        enabled: false,
      }),
    )
    expect(mockModelListQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
          input: { params: { model_type: ModelTypeEnum.rerank } },
        }),
        enabled: false,
      }),
    )
    expect(mockModelListQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
          input: { params: { model_type: ModelTypeEnum.speech2text } },
        }),
        enabled: false,
      }),
    )
    expect(mockModelListQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
          input: { params: { model_type: ModelTypeEnum.tts } },
        }),
        enabled: false,
      }),
    )

    await user.click(screen.getByRole('button', { name: /system model settings/i }))

    await waitFor(() => {
      expect(mockModelListQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
            input: { params: { model_type: ModelTypeEnum.textEmbedding } },
          }),
          enabled: true,
        }),
      )
      expect(mockModelListQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
            input: { params: { model_type: ModelTypeEnum.rerank } },
          }),
          enabled: true,
        }),
      )
      expect(mockModelListQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
            input: { params: { model_type: ModelTypeEnum.speech2text } },
          }),
          enabled: true,
        }),
      )
      expect(mockModelListQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
            input: { params: { model_type: ModelTypeEnum.tts } },
          }),
          enabled: true,
        }),
      )
    })
  })

  it('shows loading instead of empty model selectors while model lists load', async () => {
    const user = userEvent.setup()
    mockModelListQuery.mockReturnValue({ data: [], isPending: true })
    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mock Model Selector' })).not.toBeInTheDocument()
    const saveButton = screen.getByRole('button', { name: /save/i })
    expect(saveButton).toBeDisabled()

    await user.click(saveButton)
    expect(mockUpdateDefaultModel).not.toHaveBeenCalled()
  })

  it('should disable button when loading', () => {
    render(<SystemModel {...defaultProps} isLoading />)
    expect(screen.getByRole('button', { name: /system model settings/i })).toBeDisabled()
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
    selectorButtons.forEach((button) => fireEvent.click(button))

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

  it.each([
    ['System Reasoning Model', ModelTypeEnum.textGeneration, 'textGenerationDefaultModel'],
    ['Embedding Model', ModelTypeEnum.textEmbedding, 'embeddingsDefaultModel'],
    ['Rerank Model', ModelTypeEnum.rerank, 'rerankDefaultModel'],
    ['Speech to Text Model', ModelTypeEnum.speech2text, 'speech2textDefaultModel'],
    ['TTS Model', ModelTypeEnum.tts, 'ttsDefaultModel'],
  ] as const)(
    'saves a reset %s as null without changing other defaults',
    async (label, modelType, prop) => {
      const user = userEvent.setup()
      render(
        <SystemModel {...defaultProps} {...{ [prop]: { ...mockModel, model_type: modelType } }} />,
      )

      await user.click(screen.getByRole('button', { name: /system model settings/i }))
      await user.click(screen.getByRole('button', { name: `Reset ${label}` }))

      expect(screen.queryByRole('button', { name: `Reset ${label}` })).not.toBeInTheDocument()
      expect(mockUpdateDefaultModel).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(mockUpdateDefaultModel).toHaveBeenCalledWith({
          body: {
            model_settings: [
              {
                model_type: ModelTypeEnum.textGeneration,
                provider: modelType === ModelTypeEnum.textGeneration ? null : 'openai',
                model: modelType === ModelTypeEnum.textGeneration ? null : 'gpt-4',
              },
              { model_type: ModelTypeEnum.textEmbedding, provider: null, model: null },
              { model_type: ModelTypeEnum.rerank, provider: null, model: null },
              { model_type: ModelTypeEnum.speech2text, provider: null, model: null },
              { model_type: ModelTypeEnum.tts, provider: null, model: null },
            ],
          },
        })
      })
    },
  )

  it('saves a replacement selected after resetting a model', async () => {
    const user = userEvent.setup()
    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    await user.click(screen.getByRole('button', { name: 'Reset System Reasoning Model' }))
    await user.click(screen.getAllByRole('button', { name: 'Mock Model Selector' })[0]!)
    expect(screen.getByRole('button', { name: 'Reset System Reasoning Model' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockUpdateDefaultModel).toHaveBeenCalledWith({
        body: {
          model_settings: expect.arrayContaining([
            { model_type: ModelTypeEnum.textGeneration, provider: 'test', model: 'test' },
          ]),
        },
      })
    })
  })

  it('restores the saved model when a reset is cancelled and the dialog is reopened', async () => {
    const user = userEvent.setup()
    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    await user.click(screen.getByRole('button', { name: 'Reset System Reasoning Model' }))
    expect(screen.queryByText('gpt-4')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /system model settings/i }))

    expect(await screen.findByText('gpt-4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset System Reasoning Model' })).toBeEnabled()
    expect(mockUpdateDefaultModel).not.toHaveBeenCalled()
  })

  it('keeps a saved reset when reopened before refreshed defaults arrive', async () => {
    const user = userEvent.setup()
    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    await user.click(screen.getByRole('button', { name: 'Reset System Reasoning Model' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /system model settings/i }))

    expect(
      screen.queryByRole('button', { name: 'Reset System Reasoning Model' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('gpt-4')).not.toBeInTheDocument()
    expect(screen.getAllByText('No model selected')).toHaveLength(5)
  })

  it('hides reset for unconfigured model types', async () => {
    const user = userEvent.setup()
    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))

    expect(screen.getByRole('button', { name: 'Reset System Reasoning Model' })).toBeEnabled()
    for (const label of ['Embedding Model', 'Rerank Model', 'Speech to Text Model', 'TTS Model'])
      expect(screen.queryByRole('button', { name: `Reset ${label}` })).not.toBeInTheDocument()
  })

  it('should disable save without model config permission', async () => {
    mockWorkspacePermissionKeys = []
    render(<SystemModel {...defaultProps} />)

    fireEvent.click(screen.getByRole('button', { name: /system model settings/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
      expect(
        screen.queryByRole('button', { name: 'Reset System Reasoning Model' }),
      ).not.toBeInTheDocument()
    })
  })

  it('should pass hide provider settings footer flag to model selectors', async () => {
    render(<SystemModel {...defaultProps} hideProviderSettingsFooter />)

    fireEvent.click(screen.getByRole('button', { name: /system model settings/i }))
    await waitFor(() => {
      expect(mockModelSelectorProps).toHaveLength(5)
    })

    expect(mockModelSelectorProps.every((props) => props.hideProviderSettingsFooter)).toBe(true)
  })

  it('should hide model metadata in default model selectors', async () => {
    render(<SystemModel {...defaultProps} />)

    fireEvent.click(screen.getByRole('button', { name: /system model settings/i }))
    await waitFor(() => {
      expect(mockModelSelectorProps).toHaveLength(5)
    })

    expect(mockModelSelectorProps.every((props) => props.showModelMeta === false)).toBe(true)
  })

  it('should close the dialog from every empty selector configure action', async () => {
    const user = userEvent.setup()
    render(<SystemModel {...defaultProps} />)

    for (let index = 0; index < 5; index++) {
      await user.click(screen.getByRole('button', { name: /system model settings/i }))
      const configureActions = await screen.findAllByRole('button', {
        name: 'Mock Configure Empty State',
      })

      await user.click(configureActions[index]!)

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
      })
    }
  })
})

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQuery: mockModelListQuery }
})
