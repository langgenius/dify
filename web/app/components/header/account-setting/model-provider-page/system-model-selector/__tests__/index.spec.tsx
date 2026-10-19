import type { ConsoleClient } from '@/service/console'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { renderWithNuqs } from '@/test/nuqs-testing'
import { ModelTypeEnum } from '../../declarations'
import SystemModel from '../index'

type DefaultModelResponse = NonNullable<
  Awaited<ReturnType<ConsoleClient['workspaces']['current']['defaultModel']['get']>>['data']
>

const render = (ui: React.ReactElement, options?: Parameters<typeof renderWithNuqs>[1]) => {
  const { wrapper: QueryWrapper, queryClient } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({ provider: 'test' }),
    createModelCatalogFixture(),
  ])
  queryClient.removeQueries({
    queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.key(),
  })
  return { ...renderWithNuqs(<QueryWrapper>{ui}</QueryWrapper>, options), queryClient }
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
    'modelProvider.clearDefaultModel.title': 'Clear {{modelType}}?',
    'modelProvider.clearDefaultModel.description':
      'Clearing this default model may cause workflows that rely on it to fail.',
    'modelProvider.selector.configure': 'Configure provider',
    'operation.cancel': 'Cancel',
    'operation.clear': 'Clear',
    'operation.save': 'Save',
    'operation.reset': 'Reset',
    'operation.retry': 'Retry',
    loading: 'Loading',
    'actionMsg.modifiedSuccessfully': 'Modified successfully',
  })
})

const mockToastSuccess = vi.hoisted(() => vi.fn())
const mockUpdateModelList = vi.hoisted(() => vi.fn())
const mockInvalidateDefaultModel = vi.hoisted(() => vi.fn())
const mockUpdateDefaultModel = vi.hoisted(() => vi.fn(() => Promise.resolve({ result: 'success' })))
const getModelList = vi.hoisted(() => vi.fn())
const getDefaultModel = vi.hoisted(() => vi.fn())
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
      'workspaces.current.defaultModel.get': getDefaultModel,
      'workspaces.current.defaultModel.post': mockUpdateDefaultModel,
    }),
  }
})

const mockModel: DefaultModelResponse = createDefaultModelFixture({
  provider: {
    icon_small: { en_US: '', zh_Hans: '' },
    label: { en_US: 'Provider', zh_Hans: 'Provider' },
    supported_model_types: [],
    tenant_id: 'tenant-1',
  },
})

const defaultProps = { notConfigured: false }
const modelTypes = [
  ModelTypeEnum.textGeneration,
  ModelTypeEnum.textEmbedding,
  ModelTypeEnum.rerank,
  ModelTypeEnum.speech2text,
  ModelTypeEnum.tts,
]
let serverDefaults: Partial<Record<ModelTypeEnum, DefaultModelResponse | null>>
const readServerDefault = async ({
  query: { model_type },
}: {
  query: { model_type: ModelTypeEnum }
}) => ({ data: serverDefaults[model_type] ?? null })

const confirmClear = async (user: ReturnType<typeof userEvent.setup>) => {
  const confirmation = await screen.findByRole('alertdialog')
  await user.click(within(confirmation).getByRole('button', { name: 'Clear' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
}

describe('SystemModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateDefaultModel.mockReset().mockResolvedValue({ result: 'success' })
    getModelList.mockResolvedValue({ data: [] })
    serverDefaults = { [ModelTypeEnum.textGeneration]: mockModel }
    getDefaultModel.mockReset().mockImplementation(readServerDefault)
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
    expect(await screen.findByRole('button', { name: /gpt-4/ })).toBeInTheDocument()
    expect(getDefaultModel).toHaveBeenCalledTimes(5)
    for (const model_type of modelTypes)
      expect(getDefaultModel).toHaveBeenCalledWith({ query: { model_type } })
  })

  it('fetches all five latest defaults on every opening even when cached defaults are fresh', async () => {
    const user = userEvent.setup()
    const { queryClient } = render(<SystemModel {...defaultProps} />)
    for (const model_type of modelTypes) {
      queryClient.setQueryData(
        consoleQuery.workspaces.current.defaultModel.get.queryKey({
          input: { query: { model_type } },
        }),
        { data: { ...mockModel, model_type, model: `cached-${model_type}` } },
      )
      serverDefaults[model_type] = { ...mockModel, model_type, model: `latest-${model_type}` }
    }
    expect(getDefaultModel).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    for (const model_type of modelTypes)
      expect(
        await screen.findByRole('button', { name: new RegExp(`latest-${model_type}`) }),
      ).toBeInTheDocument()
    expect(getDefaultModel).toHaveBeenCalledTimes(5)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    for (const model_type of modelTypes)
      serverDefaults[model_type] = { ...mockModel, model_type, model: `reopened-${model_type}` }

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    for (const model_type of modelTypes) {
      expect(
        await screen.findByRole('button', { name: new RegExp(`reopened-${model_type}`) }),
      ).toBeInTheDocument()
      expect(
        getDefaultModel.mock.calls.filter(([input]) => input.query.model_type === model_type),
      ).toHaveLength(2)
    }
    expect(getDefaultModel).toHaveBeenCalledTimes(10)
  })

  it('waits for every default to refresh before editing or saving, treating null as a loaded default', async () => {
    const user = userEvent.setup()
    const request = createDeferred<{ data: DefaultModelResponse | null }>()
    getDefaultModel.mockImplementation((input: { query: { model_type: ModelTypeEnum } }) =>
      input.query.model_type === ModelTypeEnum.speech2text
        ? request.promise
        : readServerDefault(input),
    )
    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /gpt-4|plugin.detailPanel.configureModel/ }),
    ).not.toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.click(save)
    expect(mockUpdateDefaultModel).not.toHaveBeenCalled()

    request.resolve({ data: null })
    expect(
      await screen.findByRole('button', { name: 'Reset System Reasoning Model' }),
    ).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Reset Speech to Text Model' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'plugin.detailPanel.configureModel' }),
    ).toHaveLength(4)
    expect(save).toBeEnabled()
  })

  it('blocks stale defaults after a refresh failure and lets the user retry', async () => {
    const user = userEvent.setup()
    getDefaultModel.mockRejectedValueOnce(new Error('Unable to refresh defaults'))
    const { queryClient } = render(<SystemModel {...defaultProps} />)
    queryClient.setQueryData(
      consoleQuery.workspaces.current.defaultModel.get.queryKey({
        input: { query: { model_type: ModelTypeEnum.textGeneration } },
      }),
      { data: mockModel },
    )

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to refresh defaults')
    expect(
      screen.queryByRole('button', { name: /gpt-4|plugin.detailPanel.configureModel/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(mockUpdateDefaultModel).not.toHaveBeenCalled()

    serverDefaults[ModelTypeEnum.textGeneration] = { ...mockModel, model: 'retried-model' }
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: /retried-model/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
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
    await waitFor(() => expect(save).toBeEnabled())
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
    await user.click(await screen.findByRole('button', { name: 'Reset System Reasoning Model' }))
    await confirmClear(user)
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
    ['System Reasoning Model', ModelTypeEnum.textGeneration, true],
    ['Embedding Model', ModelTypeEnum.textEmbedding, false],
    ['Rerank Model', ModelTypeEnum.rerank, false],
    ['Speech to Text Model', ModelTypeEnum.speech2text, true],
    ['TTS Model', ModelTypeEnum.tts, true],
  ] as const)(
    'saves a reset %s as null without changing other defaults',
    async (label, modelType, requiresConfirmation) => {
      const user = userEvent.setup()
      serverDefaults[modelType] = { ...mockModel, model_type: modelType }
      render(<SystemModel {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /system model settings/i }))
      await user.click(await screen.findByRole('button', { name: `Reset ${label}` }))

      if (requiresConfirmation) {
        const confirmation = await screen.findByRole('alertdialog', { name: `Clear ${label}?` })
        expect(confirmation).toHaveAccessibleDescription(
          'Clearing this default model may cause workflows that rely on it to fail.',
        )
        expect(
          screen.getByRole('button', { name: `Reset ${label}`, hidden: true }),
        ).toBeInTheDocument()
        expect(mockUpdateDefaultModel).not.toHaveBeenCalled()
        await confirmClear(user)
      } else {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      }

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

  it.each(['Cancel', 'Escape'] as const)(
    'keeps the edited model when dismissing the clear confirmation with %s',
    async (dismissAction) => {
      enableModelChoices()
      const user = userEvent.setup()
      render(<SystemModel {...defaultProps} />)

      await user.click(screen.getByRole('button', { name: /system model settings/i }))
      await user.click(await screen.findByRole('button', { name: /gpt-4/ }))
      await user.click(
        within(
          await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
        ).getByRole('button', { name: /^Test model/ }),
      )
      await user.click(await screen.findByRole('button', { name: 'Reset System Reasoning Model' }))
      const confirmation = await screen.findByRole('alertdialog', {
        name: 'Clear System Reasoning Model?',
      })

      if (dismissAction === 'Cancel')
        await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
      else await user.keyboard('{Escape}')

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(screen.getByRole('dialog', { name: 'Default Model Settings' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Test model/ })).toBeInTheDocument()
      expect(
        await screen.findByRole('button', { name: 'Reset System Reasoning Model' }),
      ).toBeEnabled()
      expect(mockUpdateDefaultModel).not.toHaveBeenCalled()
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
    },
  )

  it('saves a replacement selected after resetting a model', async () => {
    enableModelChoices()
    const user = userEvent.setup()
    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    await user.click(await screen.findByRole('button', { name: 'Reset System Reasoning Model' }))
    await confirmClear(user)
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
    expect(
      await screen.findByRole('button', { name: 'Reset System Reasoning Model' }),
    ).toBeEnabled()
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

  it('discards the reset draft and fetches current defaults when a cancelled dialog is reopened', async () => {
    const user = userEvent.setup()
    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    await user.click(await screen.findByRole('button', { name: 'Reset System Reasoning Model' }))
    await confirmClear(user)
    expect(screen.queryByText('gpt-4')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })
    serverDefaults[ModelTypeEnum.textGeneration] = { ...mockModel, model: 'server-updated-model' }
    await user.click(screen.getByRole('button', { name: /system model settings/i }))

    expect(await screen.findByText('server-updated-model')).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Reset System Reasoning Model' }),
    ).toBeEnabled()
    expect(getDefaultModel).toHaveBeenCalledTimes(10)
    expect(mockUpdateDefaultModel).not.toHaveBeenCalled()
  })

  it('fetches the saved empty default when reopening after a reset is saved', async () => {
    const user = userEvent.setup()
    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    await user.click(await screen.findByRole('button', { name: 'Reset System Reasoning Model' }))
    await confirmClear(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })
    serverDefaults[ModelTypeEnum.textGeneration] = null
    await user.click(screen.getByRole('button', { name: /system model settings/i }))

    expect(
      await screen.findAllByRole('button', { name: 'plugin.detailPanel.configureModel' }),
    ).toHaveLength(5)
    expect(
      screen.queryByRole('button', { name: 'Reset System Reasoning Model' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('gpt-4')).not.toBeInTheDocument()
    expect(getDefaultModel).toHaveBeenCalledTimes(10)
  })

  it('keeps the edited draft when background query data changes', async () => {
    enableModelChoices()
    const user = userEvent.setup()
    const { queryClient } = render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))
    await user.click(await screen.findByRole('button', { name: /gpt-4/ }))
    await user.click(
      within(
        await screen.findByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
      ).getByRole('button', { name: /^Test model/ }),
    )

    await act(async () => {
      queryClient.setQueryData(
        consoleQuery.workspaces.current.defaultModel.get.queryKey({
          input: { query: { model_type: ModelTypeEnum.textGeneration } },
        }),
        { data: { ...mockModel, model: 'background-model' } },
      )
    })

    expect(screen.getByRole('button', { name: /^Test model/ })).toBeInTheDocument()
    expect(screen.queryByText('background-model')).not.toBeInTheDocument()
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

  it('hides reset for unconfigured model types', async () => {
    const user = userEvent.setup()
    render(<SystemModel {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /system model settings/i }))

    expect(
      await screen.findByRole('button', { name: 'Reset System Reasoning Model' }),
    ).toBeEnabled()
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
