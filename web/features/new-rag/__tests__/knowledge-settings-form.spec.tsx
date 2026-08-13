import type {
  KnowledgeFsSettingsResponse,
  KnowledgeFsSpaceDetailResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ReactNode } from 'react'
import type { Member } from '@/models/common'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { KnowledgeSettingsForm } from '../knowledge-settings-form'

const serviceMock = vi.hoisted(() => ({
  deleteSpace: vi.fn(),
  getMigration: vi.fn(),
  patchExternalAccess: vi.fn(),
  patchSettings: vi.fn(),
  patchSpace: vi.fn(),
  replaceMembers: vi.fn(),
}))

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}))

const queryKeys = {
  externalAccess: ['knowledge-fs', 'external-access'],
  permissions: ['knowledge-fs', 'permissions'],
  settings: ['knowledge-fs', 'settings'],
  space: ['knowledge-fs', 'space'],
}

vi.mock('@/next/navigation', () => ({
  useRouter: () => routerMock,
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          delete: {
            mutationOptions: () => ({ mutationFn: serviceMock.deleteSpace }),
          },
          externalAccess: {
            get: { key: () => queryKeys.externalAccess },
            put: {
              mutationOptions: () => ({ mutationFn: serviceMock.patchExternalAccess }),
            },
          },
          get: { key: () => queryKeys.space },
          members: {
            put: {
              mutationOptions: () => ({ mutationFn: serviceMock.replaceMembers }),
            },
          },
          patch: {
            mutationOptions: () => ({ mutationFn: serviceMock.patchSpace }),
          },
          permissions: {
            get: { key: () => queryKeys.permissions },
          },
          settings: {
            get: { key: () => queryKeys.settings },
            migrations: {
              byMigrationId: {
                get: {
                  queryOptions: ({
                    input,
                  }: {
                    input: {
                      params: { control_space_id: string; migration_id: string }
                    }
                  }) => ({
                    queryFn: () => serviceMock.getMigration(input),
                    queryKey: ['knowledge-fs', 'settings-migration', input.params.migration_id],
                  }),
                },
              },
            },
            patch: {
              mutationOptions: () => ({ mutationFn: serviceMock.patchSettings }),
            },
          },
        },
      },
    },
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: () => ({ data: [] }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({
    ariaDescribedBy,
    ariaInvalid,
    ariaLabelledBy,
    ariaRequired,
    defaultModel,
    onSelect,
    readonly,
  }: {
    ariaDescribedBy?: string
    ariaInvalid?: boolean
    ariaLabelledBy?: string
    ariaRequired?: boolean
    defaultModel?: { model: string; provider: string }
    onSelect?: (model: { model: string; plugin_id: string; provider: string }) => void
    readonly?: boolean
  }) => {
    const popupId = `${ariaLabelledBy ?? 'model-selector'}-popup`
    return (
      <>
        <button
          type="button"
          role="combobox"
          aria-controls={popupId}
          aria-expanded="false"
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid || undefined}
          aria-labelledby={ariaLabelledBy}
          aria-required={ariaRequired}
          disabled={readonly}
          onClick={() =>
            onSelect?.({
              model: 'openrouter/auto',
              plugin_id: 'langgenius/openrouter',
              provider: 'langgenius/openrouter/openrouter',
            })
          }
        >
          {defaultModel ? `${defaultModel.provider}:${defaultModel.model}` : 'select-model'}
        </button>
        <span id={popupId} hidden />
      </>
    )
  },
}))

vi.mock('@/app/components/base/app-icon-picker', () => ({
  default: () => null,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMock,
}))

const space = {
  control_space_id: 'space-1',
  created_at: '2026-07-28T00:00:00Z',
  knowledge_space_id: 'knowledge-1',
  owner_account_id: 'owner-1',
  permission_keys: [
    'knowledge_space_access_config',
    'knowledge_space_delete',
    'knowledge_space_edit',
    'knowledge_space_read',
  ],
  resource_version: 3,
  state: 'active' as const,
  technical_status: 'available' as const,
  technical_summary: {
    description: 'Product documentation',
    document_count: 4,
    icon: '📷',
    knowledge_space_id: 'knowledge-1',
    name: 'Camera Technical Spec',
    revision: 3,
    slug: 'camera-technical-spec',
  },
  updated_at: '2026-07-28T00:00:00Z',
  visibility: 'only_me' as const,
} satisfies KnowledgeFsSpaceDetailResponse

const settings = {
  active_profile_available: true,
  active_profile_revisions: { embedding: 1, retrieval: 1 },
  capabilities: {
    deep: true,
    index: true,
    ingest: true,
    query: true,
    research: true,
    source_sync: true,
  },
  configuration_state: 'active' as const,
  embedding: {
    model: 'text-embedding-3-large',
    plugin_id: 'langgenius/openai',
    provider: 'langgenius/openai/openai',
  },
  retrieval: {
    default_mode: 'fast' as const,
    reasoning_model: {
      model: 'gpt-4o',
      plugin_id: 'langgenius/openai',
      provider: 'langgenius/openai/openai',
    },
    rerank: {
      enabled: true,
      model: {
        model: 'rerank-v3',
        pluginId: 'langgenius/cohere',
        provider: 'cohere',
      },
    },
    score_threshold: {
      enabled: false,
      stage: 'rerank' as const,
      value: 0.5,
    },
    top_k: 3,
  },
  issues: [],
  revision: 5,
}

const externalAccess = {
  agent_enabled: true,
  mcp_enabled: true,
  revision: 2,
  service_api_enabled: true,
  workflow_enabled: true,
}

function renderForm({
  externalAccess: externalAccessOverride = externalAccess,
  members = [],
  onDraftFinish,
  onDraftStart,
  queryClient: queryClientOverride,
  serverConflict,
  settings: settingsOverride = settings,
  space: spaceOverride = space,
}: {
  externalAccess?: typeof externalAccess
  members?: Member[]
  onDraftFinish?: () => void
  onDraftStart?: () => void
  queryClient?: QueryClient
  serverConflict?: boolean
  settings?: KnowledgeFsSettingsResponse
  space?: KnowledgeFsSpaceDetailResponse
} = {}) {
  const queryClient =
    queryClientOverride ??
    new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(
    <KnowledgeSettingsForm
      externalAccess={externalAccessOverride}
      members={members}
      permissions={[]}
      serverConflict={serverConflict}
      settings={settingsOverride}
      space={spaceOverride}
      onDraftFinish={onDraftFinish}
      onDraftStart={onDraftStart}
    />,
    { wrapper: Wrapper },
  )
}

describe('KnowledgeSettingsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceMock.deleteSpace.mockResolvedValue(undefined)
    serviceMock.patchExternalAccess.mockResolvedValue(externalAccess)
    serviceMock.patchSettings.mockResolvedValue({ settings })
    serviceMock.patchSpace.mockResolvedValue(space)
    serviceMock.replaceMembers.mockResolvedValue({ data: [] })
  })

  it('keeps save disabled and shows an inline error when the name is empty', async () => {
    const user = userEvent.setup()
    renderForm()

    const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(nameInput)
    await user.tab()

    const nameError = screen.getByRole('alert')
    expect(nameError).toHaveTextContent('dataset.newKnowledge.settings.nameRequired')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAttribute('aria-describedby', nameError.id)
    expect(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.settings.saveChanges',
      }),
    ).toBeDisabled()
  })

  it('saves a changed knowledge name through the generated space mutation', async () => {
    const user = userEvent.setup()
    renderForm()

    const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated camera specs')
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.settings.saveChanges',
      }),
    )

    await waitFor(() => {
      expect(serviceMock.patchSpace).toHaveBeenCalledWith(
        {
          body: {
            name: 'Updated camera specs',
          },
          params: { control_space_id: 'space-1' },
        },
        expect.anything(),
      )
    })
    expect(serviceMock.patchSettings).not.toHaveBeenCalled()
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('finishes the basic info draft before refreshing saved server data', async () => {
    const user = userEvent.setup()
    const onDraftFinish = vi.fn()
    let finishRefresh!: () => void
    const refreshPromise = new Promise<void>((resolve) => {
      finishRefresh = resolve
    })
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    })
    vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(refreshPromise)
    renderForm({ onDraftFinish, queryClient })

    const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated without conflict flash')
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.settings.saveChanges',
      }),
    )

    await waitFor(() => expect(serviceMock.patchSpace).toHaveBeenCalledOnce())
    expect(onDraftFinish).toHaveBeenCalledOnce()
    expect(nameInput).toBeDisabled()
    finishRefresh()
    await waitFor(() => expect(nameInput).toBeEnabled())
  })

  it('uses the 40-character knowledge name limit from the design contract', () => {
    renderForm()

    expect(screen.getByRole('textbox', { name: 'datasetSettings.form.name' })).toHaveAttribute(
      'maxlength',
      '40',
    )
    expect(screen.queryByText('40 / 40')).not.toBeInTheDocument()
  })

  it('submits the settings form when Enter is pressed in the name field', async () => {
    const user = userEvent.setup()
    renderForm()

    const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated by keyboard{Enter}')

    await waitFor(() => {
      expect(serviceMock.patchSpace).toHaveBeenCalledWith(
        {
          body: { name: 'Updated by keyboard' },
          params: { control_space_id: 'space-1' },
        },
        expect.anything(),
      )
    })
  })

  it('does not submit an unchanged emoji icon when saving a description', async () => {
    const user = userEvent.setup()
    renderForm()

    const descriptionInput = screen.getByRole('textbox', {
      name: 'datasetSettings.form.desc',
    })
    await user.clear(descriptionInput)
    await user.type(descriptionInput, 'Updated product documentation')
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.settings.saveChanges',
      }),
    )

    await waitFor(() => {
      expect(serviceMock.patchSpace).toHaveBeenCalledWith(
        {
          body: {
            description: 'Updated product documentation',
          },
          params: { control_space_id: 'space-1' },
        },
        expect.anything(),
      )
    })
  })

  it('accepts 2000 description characters and blocks 2001 with a field error', async () => {
    const user = userEvent.setup()
    renderForm()

    const descriptionInput = screen.getByRole('textbox', {
      name: 'datasetSettings.form.desc',
    })
    const saveButton = screen.getByRole('button', {
      name: 'dataset.newKnowledge.settings.saveChanges',
    })
    const invalidDescription = '知'.repeat(2001)
    fireEvent.change(descriptionInput, { target: { value: invalidDescription } })

    expect(descriptionInput).toHaveValue(invalidDescription)
    expect(descriptionInput).toHaveAttribute('aria-invalid', 'true')
    expect(descriptionInput).toHaveAccessibleDescription(
      'workflow.chatVariable.modal.descriptionTooLong:{"maxLength":2000}',
    )
    expect(saveButton).toBeDisabled()
    expect(serviceMock.patchSpace).not.toHaveBeenCalled()

    const boundaryDescription = '知'.repeat(2000)
    fireEvent.change(descriptionInput, { target: { value: `${boundaryDescription} ` } })
    expect(descriptionInput).toHaveAttribute('aria-invalid', 'true')
    expect(saveButton).toBeDisabled()
    expect(serviceMock.patchSpace).not.toHaveBeenCalled()

    fireEvent.change(descriptionInput, { target: { value: boundaryDescription } })
    expect(descriptionInput).not.toHaveAttribute('aria-invalid', 'true')
    expect(saveButton).toBeEnabled()
    await user.click(saveButton)

    await waitFor(() => expect(serviceMock.patchSpace).toHaveBeenCalledOnce())
    expect(serviceMock.patchSpace).toHaveBeenCalledWith(
      {
        body: { description: boundaryDescription },
        params: { control_space_id: 'space-1' },
      },
      expect.anything(),
    )
  })

  it('disables API access directly and preserves unrelated channels', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('switch', { name: 'dataset.newKnowledge.apiAgentAccess' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(serviceMock.patchExternalAccess).toHaveBeenCalledWith(
        {
          body: {
            agent_enabled: false,
            mcp_enabled: true,
            service_api_enabled: false,
            workflow_enabled: true,
          },
          params: { control_space_id: 'space-1' },
        },
        expect.anything(),
      )
    })
    expect(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.settings.saveChanges',
      }),
    ).toBeDisabled()
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('enables Workflow access independently and preserves API and MCP channels', async () => {
    const user = userEvent.setup()
    renderForm({
      externalAccess: {
        ...externalAccess,
        workflow_enabled: false,
      },
    })

    const workflowAccessSwitch = screen.getByRole('switch', {
      name: 'dataset.newKnowledge.workflowAccess',
    })
    expect(workflowAccessSwitch).toHaveAttribute('aria-checked', 'false')
    expect(workflowAccessSwitch).toHaveAccessibleDescription(
      'dataset.newKnowledge.settings.workflowAccessDescription',
    )
    await user.click(workflowAccessSwitch)

    await waitFor(() => {
      expect(serviceMock.patchExternalAccess).toHaveBeenCalledWith(
        {
          body: {
            agent_enabled: true,
            mcp_enabled: true,
            service_api_enabled: true,
            workflow_enabled: true,
          },
          params: { control_space_id: 'space-1' },
        },
        expect.anything(),
      )
    })
    await waitFor(() => expect(workflowAccessSwitch).toHaveAttribute('aria-checked', 'true'))
  })

  it('restores the Workflow access switch after failure and retries the intended value', async () => {
    const user = userEvent.setup()
    serviceMock.patchExternalAccess.mockRejectedValueOnce(new Error('network error'))
    renderForm({
      externalAccess: {
        ...externalAccess,
        workflow_enabled: false,
      },
    })

    const workflowAccessSwitch = screen.getByRole('switch', {
      name: 'dataset.newKnowledge.workflowAccess',
    })
    await user.click(workflowAccessSwitch)

    expect(await screen.findByText('dataset.newKnowledge.settings.saveFailed')).toBeInTheDocument()
    expect(workflowAccessSwitch).toHaveAttribute('aria-checked', 'false')
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    await waitFor(() => expect(serviceMock.patchExternalAccess).toHaveBeenCalledTimes(2))
    expect(serviceMock.patchExternalAccess).toHaveBeenLastCalledWith(
      {
        body: {
          agent_enabled: true,
          mcp_enabled: true,
          service_api_enabled: true,
          workflow_enabled: true,
        },
        params: { control_space_id: 'space-1' },
      },
      expect.anything(),
    )
    await waitFor(() => expect(workflowAccessSwitch).toHaveAttribute('aria-checked', 'true'))
  })

  it('restores the API access switch after failure and retries the intended value', async () => {
    const user = userEvent.setup()
    serviceMock.patchExternalAccess.mockRejectedValueOnce(new Error('network error'))
    renderForm({
      externalAccess: {
        ...externalAccess,
        agent_enabled: false,
        service_api_enabled: false,
      },
    })

    const apiAccessSwitch = screen.getByRole('switch', {
      name: 'dataset.newKnowledge.apiAgentAccess',
    })
    expect(apiAccessSwitch).toHaveAttribute('aria-checked', 'false')
    await user.click(apiAccessSwitch)

    expect(await screen.findByText('dataset.newKnowledge.settings.saveFailed')).toBeInTheDocument()
    expect(apiAccessSwitch).toHaveAttribute('aria-checked', 'false')
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    await waitFor(() => expect(serviceMock.patchExternalAccess).toHaveBeenCalledTimes(2))
    expect(serviceMock.patchExternalAccess).toHaveBeenLastCalledWith(
      {
        body: {
          agent_enabled: true,
          mcp_enabled: true,
          service_api_enabled: true,
          workflow_enabled: true,
        },
        params: { control_space_id: 'space-1' },
      },
      expect.anything(),
    )
    await waitFor(() => expect(apiAccessSwitch).toHaveAttribute('aria-checked', 'true'))
  })

  it('requires the exact knowledge name before deletion', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: 'common.operation.cancel' })).toHaveFocus()
    const confirmButton = within(dialog).getByRole('button', {
      name: 'common.operation.delete',
    })
    const confirmationInput = within(dialog).getByRole('textbox', {
      name: /^dataset\.newKnowledge\.settings\.deleteConfirmPrompt/,
    })

    expect(confirmationInput).toHaveAttribute('placeholder', 'Camera Technical Spec')
    expect(confirmButton).toBeDisabled()
    await user.type(confirmationInput, 'Camera')
    expect(confirmButton).toBeDisabled()
    await user.clear(confirmationInput)
    await user.type(confirmationInput, 'Camera Technical Spec')
    await user.click(confirmButton)

    await waitFor(() => {
      expect(serviceMock.deleteSpace).toHaveBeenCalledWith(
        {
          params: { control_space_id: 'space-1' },
        },
        expect.anything(),
      )
    })
    expect(routerMock.replace).toHaveBeenCalledWith('/datasets?view=new')
  })

  it('keeps edits and offers retry after saving fails', async () => {
    const user = userEvent.setup()
    serviceMock.patchSpace.mockRejectedValueOnce(new Error('network error'))
    renderForm()

    const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Camera specs draft')
    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.settings.saveChanges',
      }),
    )

    expect(await screen.findByText('dataset.newKnowledge.settings.saveFailed')).toBeInTheDocument()
    expect(nameInput).toHaveValue('Camera specs draft')

    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() => expect(serviceMock.patchSpace).toHaveBeenCalledTimes(2))
  })

  it('retries an immediate retrieval settings update without submitting basic info', async () => {
    const user = userEvent.setup()
    serviceMock.patchSettings.mockRejectedValueOnce(new Error('settings unavailable'))
    renderForm()

    await user.click(
      screen.getByRole('combobox', {
        name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
      }),
    )

    expect(await screen.findByText('dataset.newKnowledge.settings.saveFailed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    await waitFor(() => expect(serviceMock.patchSettings).toHaveBeenCalledTimes(2))
    expect(serviceMock.patchSpace).not.toHaveBeenCalled()
  })

  it('shows the empty state when member search does not match the owner', async () => {
    const user = userEvent.setup()
    const owner = {
      avatar: '',
      avatar_url: null,
      email: 'owner@example.com',
      id: 'owner-1',
      name: 'Workspace owner',
      role: 'owner',
      roles: [],
      status: 'active',
    } satisfies Member
    renderForm({
      members: [owner],
      space: {
        ...space,
        visibility: 'partial_members',
      },
    })

    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
    await user.type(
      screen.getByRole('textbox', { name: 'common.operation.search' }),
      'no-such-member',
    )

    expect(screen.getByText('dataset.newKnowledge.settings.noMembersFound')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Workspace owner/ })).not.toBeInTheDocument()
  })

  it('clamps retrieval values and shows their supported ranges', async () => {
    const user = userEvent.setup()
    renderForm()

    const topKInput = screen.getByRole('spinbutton', {
      name: 'dataset.newKnowledge.settings.topKLabel',
    })
    await user.clear(topKInput)
    await user.type(topKInput, '99')
    await user.tab()

    expect(topKInput).toHaveValue(10)
    expect(screen.getByText('dataset.newKnowledge.settings.topKMinimum')).toBeInTheDocument()
    expect(screen.getByText('dataset.newKnowledge.settings.scoreRange')).toBeInTheDocument()
    await waitFor(() =>
      expect(serviceMock.patchSettings).toHaveBeenCalledWith(
        {
          body: {
            expectedRevision: 5,
            retrieval: expect.objectContaining({ topK: 10 }),
          },
          params: { control_space_id: 'space-1' },
        },
        expect.anything(),
      ),
    )
  })

  it('confirms an embedding migration and then saves it immediately', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(
      screen.getByRole('combobox', {
        name: 'dataset.newKnowledge.settings.embeddingModelLabel',
      }),
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(serviceMock.patchSettings).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))

    await waitFor(() =>
      expect(serviceMock.patchSettings).toHaveBeenCalledWith(
        {
          body: {
            embedding: {
              model: 'openrouter/auto',
              pluginId: 'langgenius/openrouter',
              provider: 'openrouter',
            },
            expectedRevision: 5,
          },
          params: { control_space_id: 'space-1' },
        },
        expect.anything(),
      ),
    )
    expect(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.settings.saveChanges',
      }),
    ).toBeDisabled()
  })

  it('keeps the score threshold available in Fast and Deep because rerank is mandatory', async () => {
    const user = userEvent.setup()
    renderForm()

    const thresholdSwitch = screen.getByRole('switch', {
      name: 'appDebug.datasetConfig.score_threshold',
    })
    expect(thresholdSwitch).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(thresholdSwitch)
    expect(thresholdSwitch).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByText('dataset.newKnowledge.settings.retrievalMode.deep'))
    expect(thresholdSwitch).not.toHaveAttribute('aria-disabled', 'true')
    expect(thresholdSwitch).toHaveAttribute('aria-checked', 'true')
  })

  it('requires a rerank model for a legacy knowledge base and saves it as enabled', async () => {
    const user = userEvent.setup()
    const onDraftFinish = vi.fn()
    const onDraftStart = vi.fn()
    serviceMock.patchSettings.mockResolvedValueOnce({
      migration: {
        changed_kind: 'retrieval',
        checkpoint: 'queued',
        created_at: '2026-07-28T00:00:00Z',
        id: 'migration-rerank-1',
        knowledge_space_id: 'knowledge-1',
        rebuild_scope: 'clone-publication',
        run_state: 'queued',
        updated_at: '2026-07-28T00:00:00Z',
      },
      settings: { ...settings, revision: 6 },
    })
    serviceMock.getMigration.mockResolvedValueOnce({
      changed_kind: 'retrieval',
      checkpoint: 'activated',
      created_at: '2026-07-28T00:00:00Z',
      id: 'migration-rerank-1',
      knowledge_space_id: 'knowledge-1',
      rebuild_scope: 'clone-publication',
      run_state: 'succeeded',
      updated_at: '2026-07-28T00:01:00Z',
    })
    renderForm({
      onDraftFinish,
      onDraftStart,
      settings: {
        ...settings,
        configuration_state: 'setup-required',
        retrieval: {
          ...settings.retrieval,
          rerank: { enabled: false, model: null },
        },
      },
    })

    expect(
      screen.queryByRole('switch', { name: 'common.modelProvider.rerankModel.key' }),
    ).not.toBeInTheDocument()
    const rerankSelector = screen.getByRole('combobox', {
      name: 'common.modelProvider.rerankModel.key',
    })
    expect(rerankSelector).toHaveAccessibleDescription(
      'dataset.newKnowledge.settings.rerankModelRequired',
    )
    expect(rerankSelector).toHaveAttribute('aria-invalid', 'true')
    await user.click(rerankSelector)

    await waitFor(() => expect(serviceMock.patchSettings).toHaveBeenCalledOnce())
    expect(serviceMock.patchSettings).toHaveBeenCalledWith(
      {
        body: {
          expectedRevision: 5,
          retrieval: expect.objectContaining({
            defaultMode: 'fast',
            reasoningModel: {
              model: 'gpt-4o',
              pluginId: 'langgenius/openai',
              provider: 'openai',
            },
            rerank: {
              enabled: true,
              model: {
                model: 'openrouter/auto',
                pluginId: 'langgenius/openrouter',
                provider: 'openrouter',
              },
            },
            scoreThreshold: expect.objectContaining({ stage: 'rerank' }),
          }),
        },
        params: { control_space_id: 'space-1' },
      },
      expect.anything(),
    )
    expect(onDraftStart).toHaveBeenCalledOnce()
    expect(screen.queryByText('dataset.newKnowledge.settings.rerankModelRequired')).toBeNull()
    await waitFor(() => expect(serviceMock.getMigration).toHaveBeenCalledOnce())
    await waitFor(() => expect(onDraftFinish).toHaveBeenCalledOnce())
  })

  it('saves a reasoning model selection immediately without enabling the basic info save', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(
      screen.getByRole('combobox', {
        name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
      }),
    )

    await waitFor(() => expect(serviceMock.patchSettings).toHaveBeenCalledOnce())
    expect(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.settings.saveChanges',
      }),
    ).toBeDisabled()
  })

  it('serializes rapid model selections and saves the latest draft with the new revision', async () => {
    let resolveFirstSave!: (value: { settings: KnowledgeFsSettingsResponse }) => void
    const firstSave = new Promise<Parameters<typeof resolveFirstSave>[0]>((resolve) => {
      resolveFirstSave = resolve
    })
    serviceMock.patchSettings
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce({ settings: { ...settings, revision: 7 } })
    const onDraftFinish = vi.fn()
    const onDraftStart = vi.fn()
    renderForm({ onDraftFinish, onDraftStart })

    const reasoningSelector = screen.getByRole('button', {
      name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
    })
    const rerankSelector = screen.getByRole('button', {
      name: 'common.modelProvider.rerankModel.key',
    })
    await act(async () => {
      reasoningSelector.click()
      rerankSelector.click()
    })

    expect(onDraftStart).toHaveBeenCalledTimes(2)
    expect(onDraftStart.mock.invocationCallOrder[0]).toBeLessThan(
      serviceMock.patchSettings.mock.invocationCallOrder[0]!,
    )
    expect(serviceMock.patchSettings).toHaveBeenCalledOnce()
    expect(serviceMock.patchSettings).toHaveBeenNthCalledWith(
      1,
      {
        body: expect.objectContaining({ expectedRevision: 5 }),
        params: { control_space_id: 'space-1' },
      },
      expect.anything(),
    )

    resolveFirstSave({ settings: { ...settings, revision: 6 } })

    await waitFor(() => expect(serviceMock.patchSettings).toHaveBeenCalledTimes(2))
    expect(serviceMock.patchSettings).toHaveBeenNthCalledWith(
      2,
      {
        body: {
          expectedRevision: 6,
          retrieval: expect.objectContaining({
            reasoningModel: {
              model: 'openrouter/auto',
              pluginId: 'langgenius/openrouter',
              provider: 'openrouter',
            },
            rerank: {
              enabled: true,
              model: {
                model: 'openrouter/auto',
                pluginId: 'langgenius/openrouter',
                provider: 'openrouter',
              },
            },
          }),
        },
        params: { control_space_id: 'space-1' },
      },
      expect.anything(),
    )
    await waitFor(() => expect(onDraftFinish).toHaveBeenCalledOnce())
  })

  it('continues a queued model selection only after its preceding migration succeeds', async () => {
    let resolveFirstSave!: (value: {
      migration: {
        changed_kind: 'retrieval'
        checkpoint: 'queued'
        created_at: string
        id: string
        knowledge_space_id: string
        rebuild_scope: 'clone-publication'
        run_state: 'queued'
        updated_at: string
      }
      settings: KnowledgeFsSettingsResponse
    }) => void
    const firstSave = new Promise<Parameters<typeof resolveFirstSave>[0]>((resolve) => {
      resolveFirstSave = resolve
    })
    serviceMock.patchSettings
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce({ settings: { ...settings, revision: 7 } })
    serviceMock.getMigration.mockResolvedValueOnce({
      changed_kind: 'retrieval',
      checkpoint: 'activated',
      created_at: '2026-07-28T00:00:00Z',
      id: 'migration-serial-1',
      knowledge_space_id: 'knowledge-1',
      rebuild_scope: 'clone-publication',
      run_state: 'succeeded',
      updated_at: '2026-07-28T00:01:00Z',
    })
    renderForm()

    const reasoningSelector = screen.getByRole('button', {
      name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
    })
    const rerankSelector = screen.getByRole('button', {
      name: 'common.modelProvider.rerankModel.key',
    })
    await act(async () => {
      reasoningSelector.click()
      rerankSelector.click()
    })
    expect(serviceMock.patchSettings).toHaveBeenCalledOnce()

    resolveFirstSave({
      migration: {
        changed_kind: 'retrieval',
        checkpoint: 'queued',
        created_at: '2026-07-28T00:00:00Z',
        id: 'migration-serial-1',
        knowledge_space_id: 'knowledge-1',
        rebuild_scope: 'clone-publication',
        run_state: 'queued',
        updated_at: '2026-07-28T00:00:00Z',
      },
      settings: { ...settings, revision: 6 },
    })

    await waitFor(() => expect(serviceMock.getMigration).toHaveBeenCalledOnce())
    await waitFor(() => expect(serviceMock.patchSettings).toHaveBeenCalledTimes(2))
    expect(serviceMock.patchSettings).toHaveBeenNthCalledWith(
      2,
      {
        body: expect.objectContaining({ expectedRevision: 6 }),
        params: { control_space_id: 'space-1' },
      },
      expect.anything(),
    )
  })

  it('coalesces a delayed retrieval save that arrives while a migration is running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let resolveMigration!: (value: {
        changed_kind: 'retrieval'
        checkpoint: 'activated'
        created_at: string
        id: string
        knowledge_space_id: string
        rebuild_scope: 'clone-publication'
        run_state: 'succeeded'
        updated_at: string
      }) => void
      const migrationPromise = new Promise<Parameters<typeof resolveMigration>[0]>((resolve) => {
        resolveMigration = resolve
      })
      serviceMock.patchSettings
        .mockResolvedValueOnce({
          migration: {
            changed_kind: 'retrieval',
            checkpoint: 'queued',
            created_at: '2026-07-28T00:00:00Z',
            id: 'migration-delayed-1',
            knowledge_space_id: 'knowledge-1',
            rebuild_scope: 'clone-publication',
            run_state: 'queued',
            updated_at: '2026-07-28T00:00:00Z',
          },
          settings: { ...settings, revision: 6 },
        })
        .mockResolvedValueOnce({ settings: { ...settings, revision: 7 } })
      serviceMock.getMigration.mockReturnValueOnce(migrationPromise)
      renderForm()

      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
        screen.getByRole('button', {
          name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
        }),
      )
      expect(await screen.findByRole('status')).toHaveTextContent('common.operation.saving')

      fireEvent.change(
        screen.getByRole('spinbutton', {
          name: 'dataset.newKnowledge.settings.topKLabel',
        }),
        { target: { value: '8' } },
      )
      await act(() => vi.advanceTimersByTimeAsync(400))
      expect(serviceMock.patchSettings).toHaveBeenCalledOnce()

      resolveMigration({
        changed_kind: 'retrieval',
        checkpoint: 'activated',
        created_at: '2026-07-28T00:00:00Z',
        id: 'migration-delayed-1',
        knowledge_space_id: 'knowledge-1',
        rebuild_scope: 'clone-publication',
        run_state: 'succeeded',
        updated_at: '2026-07-28T00:01:00Z',
      })

      await waitFor(() => expect(serviceMock.patchSettings).toHaveBeenCalledTimes(2))
      expect(serviceMock.patchSettings).toHaveBeenNthCalledWith(
        2,
        {
          body: {
            expectedRevision: 6,
            retrieval: expect.objectContaining({ topK: 8 }),
          },
          params: { control_space_id: 'space-1' },
        },
        expect.anything(),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('blocks a stale draft after the server baseline changes and restores the latest value', async () => {
    const user = userEvent.setup()
    const onDraftFinish = vi.fn()
    const onDraftStart = vi.fn()
    const renderWithName = (name: string, serverConflict = false) => (
      <KnowledgeSettingsForm
        externalAccess={externalAccess}
        members={[]}
        permissions={[]}
        serverConflict={serverConflict}
        settings={settings}
        space={{
          ...space,
          technical_summary: {
            ...space.technical_summary,
            name,
          },
        }}
        onDraftFinish={onDraftFinish}
        onDraftStart={onDraftStart}
      />
    )
    const view = renderForm({ onDraftFinish, onDraftStart })
    const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Version B')

    expect(onDraftStart).toHaveBeenCalled()
    view.rerender(renderWithName('Version C', true))
    expect(nameInput).toHaveValue('Version B')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'dataset.newKnowledge.settings.serverConflict',
    )
    expect(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.settings.saveChanges',
      }),
    ).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(nameInput).toHaveValue('Version C')
    expect(onDraftFinish).toHaveBeenCalledOnce()
    expect(serviceMock.patchSpace).not.toHaveBeenCalled()
  })

  it('allows embedding and retrieval to be configured together during initial setup', async () => {
    const user = userEvent.setup()
    renderForm({
      settings: {
        active_profile_available: false,
        active_profile_revisions: {},
        capabilities: {
          deep: false,
          index: false,
          ingest: false,
          query: false,
          research: false,
          source_sync: false,
        },
        configuration_state: 'setup-required',
        embedding: null,
        issues: [
          { code: 'missing', field: 'embedding', retryable: false },
          { code: 'missing', field: 'reasoning', retryable: false },
          { code: 'missing', field: 'rerank', retryable: false },
        ],
        retrieval: null,
        revision: 1,
      },
      space: {
        ...space,
        technical_summary: {
          ...space.technical_summary,
          document_count: 0,
        },
      },
    })

    expect(screen.getByRole('status')).toHaveTextContent('common.modelProvider.toBeConfigured')
    expect(screen.getByRole('status')).toHaveTextContent(
      'datasetSettings.form.embeddingModel · common.modelProvider.systemReasoningModel.key · common.modelProvider.rerankModel.key',
    )
    const reasoningSelector = screen.getByRole('combobox', {
      name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
    })
    expect(reasoningSelector).toHaveAccessibleDescription(
      'dataset.newKnowledge.settings.systemReasoningModelRequired',
    )
    expect(reasoningSelector).toHaveAttribute('aria-invalid', 'true')
    expect(reasoningSelector).toHaveAttribute('aria-required', 'true')
    const embeddingSelector = screen.getByRole('combobox', {
      name: 'dataset.newKnowledge.settings.embeddingModelLabel',
    })
    expect(embeddingSelector).toHaveAccessibleDescription(
      'dataset.newKnowledge.settings.embeddingModelRequired',
    )
    expect(embeddingSelector).toHaveAttribute('aria-invalid', 'true')
    const rerankSelector = screen.getByRole('combobox', {
      name: 'common.modelProvider.rerankModel.key',
    })
    expect(rerankSelector).toHaveAccessibleDescription(
      'dataset.newKnowledge.settings.rerankModelRequired',
    )
    expect(rerankSelector).toHaveAttribute('aria-invalid', 'true')
    expect(
      screen.getByRole('switch', { name: 'dataset.newKnowledge.apiAgentAccess' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('switch', { name: 'dataset.newKnowledge.workflowAccess' }),
    ).toHaveAttribute('aria-disabled', 'true')

    await user.click(
      screen.getByRole('combobox', {
        name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
      }),
    )
    expect(
      screen.queryByText('dataset.newKnowledge.settings.systemReasoningModelRequired'),
    ).not.toBeInTheDocument()
    expect(embeddingSelector).toBeEnabled()
    await user.click(embeddingSelector)
    expect(
      screen.queryByText('dataset.newKnowledge.settings.embeddingModelRequired'),
    ).not.toBeInTheDocument()
    expect(serviceMock.patchSettings).not.toHaveBeenCalled()
    await user.click(rerankSelector)
    expect(
      screen.queryByText('dataset.newKnowledge.settings.rerankModelRequired'),
    ).not.toBeInTheDocument()

    await waitFor(() =>
      expect(serviceMock.patchSettings).toHaveBeenCalledWith(
        {
          body: {
            embedding: expect.any(Object),
            expectedRevision: 1,
            retrieval: expect.any(Object),
          },
          params: { control_space_id: 'space-1' },
        },
        expect.anything(),
      ),
    )
  })

  it('keeps active-profile controls enabled when a replacement candidate fails validation', () => {
    renderForm({
      settings: {
        ...settings,
        configuration_state: 'validation-failed',
        issues: [{ code: 'unavailable', field: 'embedding', retryable: false }],
      },
    })

    expect(
      screen.getByRole('switch', { name: 'dataset.newKnowledge.apiAgentAccess' }),
    ).not.toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('switch', { name: 'dataset.newKnowledge.workflowAccess' }),
    ).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps API access available without showing an idle pending-validation status', () => {
    renderForm({
      settings: {
        ...settings,
        configuration_state: 'pending-validation',
      },
    })

    const apiAccessSwitch = screen.getByRole('switch', {
      name: 'dataset.newKnowledge.apiAgentAccess',
    })

    expect(apiAccessSwitch).not.toHaveAttribute('aria-disabled', 'true')
    expect(apiAccessSwitch).toHaveAccessibleDescription(
      'dataset.newKnowledge.settings.apiAccessDescription',
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a recovery alert when initial model validation fails', () => {
    renderForm({
      settings: {
        ...settings,
        configuration_state: 'validation-failed',
        issues: [{ code: 'validation_failed', field: 'embedding', retryable: true }],
      },
    })

    expect(screen.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
    expect(screen.getByRole('alert')).toHaveTextContent('datasetSettings.form.embeddingModel')
  })

  it('asks before following a link while the form has unsaved changes', async () => {
    const user = userEvent.setup()
    renderForm()
    const destination = document.createElement('a')
    destination.href = '/datasets/new/space-1/sources'
    destination.textContent = 'Go to sources'
    document.body.append(destination)

    const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Unsaved camera specs')
    await user.click(destination)

    const dialog = await screen.findByRole('alertdialog')
    expect(routerMock.push).not.toHaveBeenCalled()
    await user.click(
      within(dialog).getByRole('button', {
        name: 'dataset.newKnowledge.discardDraftConfirm',
      }),
    )

    expect(routerMock.push).toHaveBeenCalledWith('/datasets/new/space-1/sources')
    destination.remove()
  })

  it('protects unsaved changes from browser unload', async () => {
    const user = userEvent.setup()
    renderForm()

    const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Unsaved camera specs')
    const event = new Event('beforeunload', { cancelable: true })
    globalThis.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it('normalizes split Knowledge FS provider identities for the model selector', () => {
    renderForm({
      settings: {
        ...settings,
        retrieval: {
          ...settings.retrieval,
          reasoning_model: {
            model: 'openrouter/auto',
            plugin_id: 'langgenius/openrouter',
            provider: 'openrouter',
          },
        },
      },
    })

    expect(
      screen.getByRole('combobox', {
        name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
      }),
    ).toBeInTheDocument()
  })

  it('splits a canonical model provider before saving Knowledge FS settings', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(
      screen.getByRole('combobox', {
        name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
      }),
    )

    await waitFor(() => {
      expect(serviceMock.patchSettings).toHaveBeenCalledWith(
        {
          body: {
            expectedRevision: 5,
            retrieval: expect.objectContaining({
              reasoningModel: {
                model: 'openrouter/auto',
                pluginId: 'langgenius/openrouter',
                provider: 'openrouter',
              },
            }),
          },
          params: { control_space_id: 'space-1' },
        },
        expect.anything(),
      )
    })
  })

  it('waits for an active profile migration before reporting the settings as saved', async () => {
    const user = userEvent.setup()
    let resolveMigration!: (value: {
      changed_kind: 'retrieval'
      checkpoint: 'activated'
      created_at: string
      id: string
      knowledge_space_id: string
      rebuild_scope: 'clone-publication'
      run_state: 'succeeded'
      updated_at: string
    }) => void
    const migrationPromise = new Promise<Parameters<typeof resolveMigration>[0]>((resolve) => {
      resolveMigration = resolve
    })
    serviceMock.patchSettings.mockResolvedValueOnce({
      migration: {
        changed_kind: 'retrieval',
        checkpoint: 'queued',
        created_at: '2026-07-28T00:00:00Z',
        id: 'migration-1',
        knowledge_space_id: 'knowledge-1',
        rebuild_scope: 'clone-publication',
        run_state: 'queued',
        updated_at: '2026-07-28T00:00:00Z',
      },
      settings,
    })
    serviceMock.getMigration.mockReturnValueOnce(migrationPromise)
    renderForm()

    await user.click(
      screen.getByRole('combobox', {
        name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
      }),
    )

    expect(await screen.findByRole('status')).toHaveTextContent('common.operation.saving')
    expect(toastMock.success).not.toHaveBeenCalled()

    resolveMigration({
      changed_kind: 'retrieval',
      checkpoint: 'activated',
      created_at: '2026-07-28T00:00:00Z',
      id: 'migration-1',
      knowledge_space_id: 'knowledge-1',
      rebuild_scope: 'clone-publication',
      run_state: 'succeeded',
      updated_at: '2026-07-28T00:01:00Z',
    })

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('offers retry when a durable profile migration fails', async () => {
    const user = userEvent.setup()
    serviceMock.patchSettings.mockResolvedValueOnce({
      migration: {
        changed_kind: 'retrieval',
        checkpoint: 'evaluated',
        created_at: '2026-07-28T00:00:00Z',
        id: 'migration-1',
        knowledge_space_id: 'knowledge-1',
        rebuild_scope: 'clone-publication',
        run_state: 'running',
        updated_at: '2026-07-28T00:00:30Z',
      },
      settings,
    })
    serviceMock.getMigration.mockResolvedValueOnce({
      changed_kind: 'retrieval',
      checkpoint: 'evaluated',
      created_at: '2026-07-28T00:00:00Z',
      error_code: 'PROFILE_MIGRATION_EVALUATION_FAILED',
      id: 'migration-1',
      knowledge_space_id: 'knowledge-1',
      rebuild_scope: 'clone-publication',
      run_state: 'failed',
      updated_at: '2026-07-28T00:01:00Z',
    })
    renderForm()

    await user.click(
      screen.getByRole('combobox', {
        name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
      }),
    )

    expect(await screen.findByText('dataset.newKnowledge.settings.saveFailed')).toBeInTheDocument()
    expect(toastMock.success).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    await waitFor(() => expect(serviceMock.patchSettings).toHaveBeenCalledTimes(2))
  })

  it('fully locks the page for a view-only user', () => {
    renderForm({
      space: {
        ...space,
        permission_keys: ['knowledge_space_read'],
      },
    })

    expect(screen.getByText('dataset.newKnowledge.settings.viewOnly')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'datasetSettings.form.name' })).toBeDisabled()
    expect(
      screen.getByRole('combobox', { name: 'datasetSettings.form.permissions' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('switch', { name: 'dataset.newKnowledge.apiAgentAccess' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('switch', { name: 'dataset.newKnowledge.workflowAccess' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.queryByRole('button', {
        name: 'dataset.newKnowledge.settings.saveChanges',
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.delete' }),
    ).not.toBeInTheDocument()
  })
})
