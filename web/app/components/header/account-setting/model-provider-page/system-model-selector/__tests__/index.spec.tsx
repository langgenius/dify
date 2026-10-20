import type { DefaultModelResponse } from '../../declarations'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { ModelTypeEnum } from '../../declarations'
import SystemModel from '../index'

const render = (ui: React.ReactElement, options?: Parameters<typeof renderWithNuqs>[1]) => {
  const { wrapper: QueryWrapper, queryClient } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({ provider: 'test' }),
    createModelCatalogFixture(),
  ])
  queryClient.removeQueries({
    queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.key(),
  })
  return renderWithNuqs(<QueryWrapper>{ui}</QueryWrapper>, options)
}

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
    'modelProvider.selector.configure': 'Configure provider',
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
const getModelList = vi.hoisted(() => vi.fn())
const enableModelChoices = () => {
  getModelList.mockImplementation(
    async ({ params: { model_type } }: { params: { model_type: ModelTypeEnum } }) => ({
      data: [
        createModelCatalogFixture({
          provider: 'test',
          models: [
            createCatalogModelFixture({
              model_type,
              model: 'test',
              label: { en_US: 'Test model' },
            }),
          ],
        }),
      ],
    }),
  )
}
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
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.models.modelTypes.byModelType.get': getModelList,
      'workspaces.current.defaultModel.post': mockUpdateDefaultModel,
    }),
  }
})

const mockModel: DefaultModelResponse = {
  model: 'gpt-4',
  model_type: ModelTypeEnum.textGeneration,
  provider: {
    provider: 'openai',
    icon_small: { en_US: '', zh_Hans: '' },
    label: { en_US: 'Provider', zh_Hans: 'Provider' },
    supported_model_types: [],
    tenant_id: 'tenant-1',
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
    mockUpdateDefaultModel.mockReset().mockResolvedValue({ result: 'success' })
    getModelList.mockResolvedValue({ data: [] })
    mockWorkspacePermissionKeys = ['plugin.model_config']
  })

  it('should open dialog when button is clicked', async () => {
    const user = userEvent.setup()
    render(<SystemModel {...defaultProps} />)
    const button = screen.getByRole('button', { name: /system model settings/i })
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    expect(button).toHaveAttribute('aria-expanded', 'false')

    await user.click(button)
    expect(
      await screen.findByRole('dialog', { name: 'Default Model Settings' }),
    ).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the dialog from URL state', async () => {
    render(<SystemModel {...defaultProps} />, { searchParams: '?dialog=system-models' })

    expect(await screen.findByRole('button', { name: /save/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /system model settings/i, hidden: true }),
    ).toHaveAttribute('aria-expanded', 'true')
    expect(getModelList).toHaveBeenCalledWith({
      params: { model_type: ModelTypeEnum.textEmbedding },
    })
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

    expect(getModelList).not.toHaveBeenCalledWith({
      params: { model_type: ModelTypeEnum.textEmbedding },
    })
    expect(getModelList).not.toHaveBeenCalledWith({ params: { model_type: ModelTypeEnum.rerank } })
    expect(getModelList).not.toHaveBeenCalledWith({
      params: { model_type: ModelTypeEnum.speech2text },
    })
    expect(getModelList).not.toHaveBeenCalledWith({ params: { model_type: ModelTypeEnum.tts } })

    await user.click(screen.getByRole('button', { name: /system model settings/i }))

    await waitFor(() => {
      expect(getModelList).toHaveBeenCalledWith({
        params: { model_type: ModelTypeEnum.textEmbedding },
      })
      expect(getModelList).toHaveBeenCalledWith({ params: { model_type: ModelTypeEnum.rerank } })
      expect(getModelList).toHaveBeenCalledWith({
        params: { model_type: ModelTypeEnum.speech2text },
      })
      expect(getModelList).toHaveBeenCalledWith({ params: { model_type: ModelTypeEnum.tts } })
    })
  })

  it('shows loading instead of empty model selectors while model lists load', async () => {
    const user = userEvent.setup()
    getModelList.mockReturnValue(new Promise(() => {}))
    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /gpt-4|plugin.detailPanel.configureModel/ }),
    ).not.toBeInTheDocument()
    const saveButton = screen.getByRole('button', { name: /save/i })
    expect(saveButton).toBeDisabled()

    await user.click(saveButton)
    expect(mockUpdateDefaultModel).not.toHaveBeenCalled()
  })

  it('should disable button when loading', () => {
    render(<SystemModel {...defaultProps} isLoading />)
    expect(screen.getByRole('button', { name: /system model settings/i })).toBeDisabled()
  })

  it('should save selected models and show success feedback', async () => {
    enableModelChoices()
    const user = userEvent.setup()
    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    })

    const selectorButtons = await screen.findAllByRole('button', {
      name: /gpt-4|plugin.detailPanel.configureModel/,
    })
    for (const button of selectorButtons) {
      await user.click(button)
      await user.click(
        within(
          await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
        ).getByRole('button', { name: /^Test model/ }),
      )
    }

    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(mockUpdateDefaultModel).toHaveBeenCalledWith({
        body: {
          model_settings: [
            ModelTypeEnum.textGeneration,
            ModelTypeEnum.textEmbedding,
            ModelTypeEnum.rerank,
            ModelTypeEnum.speech2text,
            ModelTypeEnum.tts,
          ].map((model_type) => ({ model_type, provider: 'test', model: 'test' })),
        },
      })
      expect(mockToastSuccess).not.toHaveBeenCalled()
      expect(mockInvalidateDefaultModel).toHaveBeenCalledTimes(5)
      expect(mockUpdateModelList).toHaveBeenCalledTimes(5)
    })
  })

  it('blocks repeated submission, editing and dismissal until saving completes', async () => {
    const user = userEvent.setup()
    const request = createDeferred<{ result: string }>()
    mockUpdateDefaultModel.mockReturnValueOnce(request.promise)
    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    const save = screen.getByRole('button', { name: 'Save' })
    await user.click(save)
    await waitFor(() => expect(save).toHaveAttribute('aria-disabled', 'true'))
    expect(save).toBeEnabled()
    expect(save).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset System Reasoning Model' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /gpt-4/ })).toBeDisabled()

    await user.click(save)
    await user.keyboard('{Enter}{Escape}')
    expect(mockUpdateDefaultModel).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'Default Model Settings' })).toBeInTheDocument()

    request.resolve({ result: 'success' })
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Default Model Settings' }),
      ).not.toBeInTheDocument(),
    )
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it('shows a save error inline, preserves the draft and allows retry', async () => {
    const user = userEvent.setup()
    mockUpdateDefaultModel.mockRejectedValueOnce(new Error('Unable to save model settings'))
    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    await user.click(screen.getByRole('button', { name: 'Reset System Reasoning Model' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save model settings')
    expect(
      screen.queryByRole('button', { name: 'Reset System Reasoning Model' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(mockInvalidateDefaultModel).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Default Model Settings' }),
      ).not.toBeInTheDocument(),
    )
    expect(mockUpdateDefaultModel).toHaveBeenCalledTimes(2)
    expect(mockUpdateDefaultModel.mock.calls[1]).toEqual(mockUpdateDefaultModel.mock.calls[0])
  })

  it('should keep the dialog open when saving does not succeed', async () => {
    const user = userEvent.setup()
    mockUpdateDefaultModel.mockResolvedValueOnce({ result: 'failed' })

    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    })

    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /save/i }))

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
    enableModelChoices()
    const user = userEvent.setup()
    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    await user.click(screen.getByRole('button', { name: 'Reset System Reasoning Model' }))
    await user.click(
      (
        await screen.findAllByRole('button', { name: /gpt-4|plugin.detailPanel.configureModel/ })
      )[0]!,
    )
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
      ).getByRole('button', { name: /^Test model/ }),
    )
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
    expect(
      screen.getAllByRole('button', { name: 'plugin.detailPanel.configureModel' }),
    ).toHaveLength(5)
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
    const user = userEvent.setup()
    mockWorkspacePermissionKeys = []
    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
      expect(
        screen.queryByRole('button', { name: 'Reset System Reasoning Model' }),
      ).not.toBeInTheDocument()
    })
  })

  it('should close the dialog from every empty selector configure action', async () => {
    const user = userEvent.setup()
    render(<SystemModel {...defaultProps} />)

    for (let index = 0; index < 5; index++) {
      await user.click(screen.getByRole('button', { name: /system model settings/i }))
      const selectors = await screen.findAllByRole('button', {
        name: /gpt-4|plugin.detailPanel.configureModel/,
      })
      await user.click(selectors[index]!)
      await user.click(await screen.findByRole('button', { name: 'Configure provider' }))

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
      })
    }
  })
})
