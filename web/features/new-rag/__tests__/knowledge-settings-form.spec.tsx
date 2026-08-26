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
import { createSystemFeaturesFixture } from '@/test/console/system-features'
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
  accountProfile: [['console', 'account', 'profile', 'get'], { type: 'query' }],
  externalAccess: ['knowledge-fs', 'external-access'],
  permissions: ['knowledge-fs', 'permissions'],
  settings: ['knowledge-fs', 'settings'],
  space: ['knowledge-fs', 'space'],
  systemFeatures: ['console', 'system-features'],
}

vi.mock('@/next/navigation', () => ({
  useRouter: () => routerMock,
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    account: {
      profile: {
        get: { queryKey: () => queryKeys.accountProfile },
      },
    },
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
    systemFeatures: {
      get: {
        queryOptions: () => ({ queryKey: queryKeys.systemFeatures }),
      },
    },
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelList: () => ({ data: [] }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  ModelSelector: ({
    ariaDescribedBy,
    ariaInvalid,
    ariaLabelledBy,
    ariaRequired,
    value,
    onValueChange,
    disabled,
  }: {
    ariaDescribedBy?: string
    ariaInvalid?: boolean
    ariaLabelledBy?: string
    ariaRequired?: boolean
    value?: { model: string; provider: string }
    onValueChange?: (model: { model: string; plugin_id: string; provider: string }) => void
    disabled?: boolean
  }) => {
    const popupId = `${ariaLabelledBy ?? 'model-selector'}-popup`
    return (
      <>
        <button
          type="button"
          aria-controls={popupId}
          aria-expanded="false"
          aria-describedby={ariaDescribedBy}
          aria-labelledby={ariaLabelledBy}
          data-invalid={ariaInvalid ? '' : undefined}
          data-required={ariaRequired ? '' : undefined}
          disabled={disabled}
          onClick={() =>
            onValueChange?.({
              model: 'openrouter/auto',
              plugin_id: 'langgenius/openrouter',
              provider: 'langgenius/openrouter/openrouter',
            })
          }
        >
          {value ? `${value.provider}:${value.model}` : 'select-model'}
        </button>
        <span id={popupId} hidden />
      </>
    )
  },
}))

vi.mock('@/app/components/base/app-icon-picker', () => ({
  default: ({
    open,
    onSelect,
  }: {
    open: boolean
    onSelect?: (selection: { background: string; icon: string; type: 'emoji' }) => void
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => onSelect?.({ background: '#FCE7F6', icon: 'camera', type: 'emoji' })}
      >
        Select camera style
      </button>
    ) : null,
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
  accountProfile = {},
  externalAccess: externalAccessOverride = externalAccess,
  members = [],
  onDraftFinish,
  onDraftStart,
  queryClient: queryClientOverride,
  serverConflict,
  settings: settingsOverride = settings,
  space: spaceOverride = space,
}: {
  accountProfile?: Partial<{
    avatar: string
    avatar_url: string | null
    email: string
    id: string
    is_password_set: boolean
    name: string
    timezone: string
  }>
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
  queryClient.setQueryData(queryKeys.accountProfile, {
    meta: { currentEnv: null, currentVersion: null },
    profile: {
      avatar: '',
      avatar_url: null,
      email: 'test@dify.ai',
      id: 'user-1',
      is_password_set: false,
      name: 'Test User',
      timezone: 'Asia/Shanghai',
      ...accountProfile,
    },
  })
  queryClient.setQueryData(queryKeys.systemFeatures, createSystemFeaturesFixture())
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
    const saveButton = screen.getByRole('button', {
      name: 'dataset.newKnowledge.settings.saveChanges',
    })
    await user.click(saveButton)

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
    expect(toastMock.success).toHaveBeenCalledWith('common.api.actionSuccess')
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

  it('keeps access and retrieval controls interactive while basic info is saving', async () => {
    const user = userEvent.setup()
    let finishBasicSave!: (value: typeof space) => void
    serviceMock.patchSpace.mockReturnValueOnce(
      new Promise((resolve) => {
        finishBasicSave = resolve
      }),
    )
    renderForm()

    const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Saving camera specs')
    await user.click(
      screen.getByRole('button', { name: 'dataset.newKnowledge.settings.saveChanges' }),
    )

    await waitFor(() => expect(serviceMock.patchSpace).toHaveBeenCalledOnce())
    const saveButton = screen.getByRole('button', {
      name: 'dataset.newKnowledge.settings.saveChanges',
    })
    expect(saveButton).toHaveAttribute('aria-disabled', 'true')
    expect(saveButton).toHaveTextContent('dataset.newKnowledge.settings.saveChanges')
    expect(screen.queryByText('common.operation.saving')).not.toBeInTheDocument()
    const apiAccessSwitch = screen.getByRole('switch', {
      name: 'dataset.newKnowledge.apiAgentAccess',
    })
    const reasoningSelector = screen.getByRole('button', {
      name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
    })
    expect(apiAccessSwitch).not.toHaveAttribute('aria-disabled', 'true')
    expect(reasoningSelector).toBeEnabled()
    await user.click(apiAccessSwitch)
    await user.click(reasoningSelector)

    await waitFor(() => expect(serviceMock.patchExternalAccess).toHaveBeenCalledOnce())
    await waitFor(() => expect(serviceMock.patchSettings).toHaveBeenCalledOnce())
    finishBasicSave(space)
    await waitFor(() => expect(serviceMock.patchSpace).toHaveResolved())
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

  it('saves the selected emoji background style with the knowledge icon', async () => {
    const user = userEvent.setup()
    renderForm()

    const iconButton = screen.getByRole('button', {
      name: 'datasetSettings.form.nameAndIcon',
    })
    await user.click(iconButton)
    await user.click(screen.getByRole('button', { name: 'Select camera style' }))

    expect(iconButton.firstElementChild).toHaveStyle({ background: '#FCE7F6' })

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.settings.saveChanges',
      }),
    )

    await waitFor(() => {
      expect(serviceMock.patchSpace).toHaveBeenCalledWith(
        {
          body: {
            icon: 'camera',
            icon_background: '#FCE7F6',
          },
          params: { control_space_id: 'space-1' },
        },
        expect.anything(),
      )
    })
  })

  it('restores a saved emoji background style from the space detail', () => {
    renderForm({
      space: {
        ...space,
        technical_summary: {
          ...space.technical_summary,
          icon_background: '#D3F8DF',
        },
      },
    })

    const iconButton = screen.getByRole('button', {
      name: 'datasetSettings.form.nameAndIcon',
    })
    expect(iconButton.firstElementChild).toHaveStyle({ background: '#D3F8DF' })
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
    expect(toastMock.success).toHaveBeenCalledWith('common.api.actionSuccess')
  })

  it('keeps access channels submittable before the first model profile activates', async () => {
    const user = userEvent.setup()
    renderForm({
      settings: {
        ...settings,
        active_profile_available: false,
        active_profile_revisions: {},
        capabilities: {
          deep: false,
          index: false,
          ingest: true,
          query: false,
          research: false,
          source_sync: true,
        },
      },
    })

    const apiAccessSwitch = screen.getByRole('switch', {
      name: 'dataset.newKnowledge.apiAgentAccess',
    })
    const workflowAccessSwitch = screen.getByRole('switch', {
      name: 'dataset.newKnowledge.workflowAccess',
    })
    expect(apiAccessSwitch).not.toHaveAttribute('aria-disabled', 'true')
    expect(workflowAccessSwitch).not.toHaveAttribute('aria-disabled', 'true')
    expect(apiAccessSwitch).toHaveAccessibleDescription(
      'dataset.newKnowledge.settings.apiAccessDescription',
    )

    await user.click(apiAccessSwitch)

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
    await waitFor(() => expect(apiAccessSwitch).toHaveAttribute('aria-checked', 'false'))
    expect(apiAccessSwitch).not.toHaveAttribute('aria-disabled', 'true')
    expect(workflowAccessSwitch).not.toHaveAttribute('aria-disabled', 'true')

    await user.click(apiAccessSwitch)

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
  })

  it('keeps unrelated form controls interactive while external access is saving', async () => {
    const user = userEvent.setup()
    let finishExternalAccessSave!: (value: typeof externalAccess) => void
    serviceMock.patchExternalAccess.mockReturnValueOnce(
      new Promise((resolve) => {
        finishExternalAccessSave = resolve
      }),
    )
    renderForm()

    const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Unsaved camera notes')
    await user.click(screen.getByRole('switch', { name: 'dataset.newKnowledge.apiAgentAccess' }))

    await waitFor(() => expect(serviceMock.patchExternalAccess).toHaveBeenCalledOnce())
    expect(nameInput).toBeEnabled()
    expect(nameInput).toHaveValue('Unsaved camera notes')
    expect(screen.getByRole('textbox', { name: 'datasetSettings.form.desc' })).toBeEnabled()
    expect(
      screen.getByRole('textbox', { name: 'dataset.newKnowledge.settings.topKLabel' }),
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.settings.saveChanges' }),
    ).toBeEnabled()

    finishExternalAccessSave(externalAccess)
    await waitFor(() => expect(serviceMock.patchExternalAccess).toHaveResolved())
  })

  it('serializes independent access switches without blocking either control', async () => {
    const user = userEvent.setup()
    let finishFirstAccessSave!: (value: typeof externalAccess) => void
    serviceMock.patchExternalAccess.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirstAccessSave = resolve
      }),
    )
    renderForm()

    const apiAccessSwitch = screen.getByRole('switch', {
      name: 'dataset.newKnowledge.apiAgentAccess',
    })
    const workflowAccessSwitch = screen.getByRole('switch', {
      name: 'dataset.newKnowledge.workflowAccess',
    })
    await user.click(apiAccessSwitch)

    await waitFor(() => expect(serviceMock.patchExternalAccess).toHaveBeenCalledOnce())
    expect(apiAccessSwitch).not.toHaveAttribute('aria-disabled', 'true')
    expect(workflowAccessSwitch).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(workflowAccessSwitch)
    expect(serviceMock.patchExternalAccess).toHaveBeenCalledOnce()

    finishFirstAccessSave(externalAccess)
    await waitFor(() => expect(serviceMock.patchExternalAccess).toHaveBeenCalledTimes(2))
    expect(serviceMock.patchExternalAccess).toHaveBeenLastCalledWith(
      {
        body: {
          agent_enabled: false,
          mcp_enabled: true,
          service_api_enabled: false,
          workflow_enabled: false,
        },
        params: { control_space_id: 'space-1' },
      },
      expect.anything(),
    )
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

  it('keeps the Workflow access edit and shows an error toast after failure', async () => {
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

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('dataset.newKnowledge.settings.saveFailed'),
    )
    expect(workflowAccessSwitch).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText('dataset.newKnowledge.settings.saveFailed')).not.toBeInTheDocument()
  })

  it('keeps the API access edit and shows an error toast after failure', async () => {
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

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('dataset.newKnowledge.settings.saveFailed'),
    )
    expect(apiAccessSwitch).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText('dataset.newKnowledge.settings.saveFailed')).not.toBeInTheDocument()
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

  it('keeps edits and shows a standard error toast after saving fails', async () => {
    const user = userEvent.setup()
    serviceMock.patchSpace.mockRejectedValueOnce(new Error('network error'))
    renderForm()

    const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Camera specs draft')
    const saveButton = screen.getByRole('button', {
      name: 'dataset.newKnowledge.settings.saveChanges',
    })
    await user.click(saveButton)

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('dataset.newKnowledge.settings.saveFailed'),
    )
    expect(nameInput).toHaveValue('Camera specs draft')
    expect(screen.queryByText('dataset.newKnowledge.settings.saveFailed')).not.toBeInTheDocument()
    expect(saveButton).toBeEnabled()

    await user.click(saveButton)
    await waitFor(() => expect(serviceMock.patchSpace).toHaveBeenCalledTimes(2))
    expect(toastMock.success).toHaveBeenCalledWith('common.api.actionSuccess')
  })

  it('shows an error toast for a failed retrieval settings update without submitting basic info', async () => {
    const user = userEvent.setup()
    serviceMock.patchSettings.mockRejectedValueOnce(new Error('settings unavailable'))
    renderForm()

    await user.click(
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
      }),
    )

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('dataset.newKnowledge.settings.saveFailed'),
    )
    expect(screen.queryByText('dataset.newKnowledge.settings.saveFailed')).not.toBeInTheDocument()
    expect(serviceMock.patchSpace).not.toHaveBeenCalled()
  })

  it('reuses the legacy permission picker for modes, search, and member selection', async () => {
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
    const member = {
      ...owner,
      email: 'member@example.com',
      id: 'member-1',
      name: 'Team Member',
      role: 'normal',
    } satisfies Member
    renderForm({
      members: [owner, member],
    })

    await user.click(
      screen.getByRole('button', { name: /datasetSettings\.form\.permissionsOnlyMe/ }),
    )
    const picker = screen.getByRole('dialog', { name: 'datasetSettings.form.permissions' })
    expect(
      within(picker).getByRole('radio', {
        name: 'datasetSettings.form.permissionsAllMember',
      }),
    ).toBeInTheDocument()
    await user.click(
      within(picker).getByRole('radio', {
        name: 'datasetSettings.form.permissionsInvitedMembers',
      }),
    )

    const search = within(picker).getByRole('searchbox', { name: 'common.operation.search' })
    await user.type(search, 'Team')
    expect(await within(picker).findByRole('button', { name: /Team Member/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.add' })).not.toBeInTheDocument()
  })

  it('requires a non-owner member for partial access and disables save', async () => {
    const user = userEvent.setup()
    renderForm({
      accountProfile: {
        email: 'owner@example.com',
        id: 'owner-1',
        name: 'Workspace owner',
      },
    })

    await user.click(
      screen.getByRole('button', { name: /datasetSettings\.form\.permissionsOnlyMe/ }),
    )
    await user.click(
      screen.getByRole('radio', {
        name: 'datasetSettings.form.permissionsInvitedMembers',
      }),
    )

    const error = screen.getByRole('alert')
    const trigger = screen.getByRole('button', { name: /Workspace owner/ })
    expect(error).toHaveTextContent('dataset.newKnowledge.settings.membersRequired')
    expect(trigger).toHaveAttribute('aria-invalid', 'true')
    expect(trigger).toHaveAttribute('aria-describedby', error.id)
    expect(
      screen.getByRole('button', { name: 'dataset.newKnowledge.settings.saveChanges' }),
    ).toBeDisabled()
  })

  it('clamps retrieval values and shows their supported ranges', async () => {
    const user = userEvent.setup()
    renderForm()

    const topKInput = screen.getByRole('textbox', {
      name: 'dataset.newKnowledge.settings.topKLabel',
    })
    const thresholdInput = screen.getByRole('textbox', {
      name: 'appDebug.datasetConfig.score_threshold',
    })
    expect(topKInput).toHaveAttribute('aria-roledescription', 'Number field')
    expect(thresholdInput).toHaveAttribute('aria-roledescription', 'Number field')
    expect(thresholdInput).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'Increment value' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Decrement value' })).toHaveLength(2)

    await user.clear(topKInput)
    await user.type(topKInput, '99')
    await user.tab()

    expect(topKInput).toHaveValue('10')
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

  it('clamps the score threshold to the standard field range', async () => {
    const user = userEvent.setup()
    renderForm({
      settings: {
        ...settings,
        retrieval: {
          ...settings.retrieval,
          score_threshold: {
            ...settings.retrieval.score_threshold,
            enabled: true,
          },
        },
      },
    })

    const thresholdInput = screen.getByRole('textbox', {
      name: 'appDebug.datasetConfig.score_threshold',
    })
    await user.clear(thresholdInput)
    await user.type(thresholdInput, '2')
    await user.tab()

    expect(thresholdInput).toHaveValue('1')
    await waitFor(() =>
      expect(serviceMock.patchSettings).toHaveBeenCalledWith(
        {
          body: {
            expectedRevision: 5,
            retrieval: expect.objectContaining({
              scoreThreshold: expect.objectContaining({ value: 1 }),
            }),
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
      screen.getByRole('button', {
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

  it('keeps a rejected score threshold draft and explains permission failures', async () => {
    const user = userEvent.setup()
    serviceMock.patchSettings.mockRejectedValueOnce(
      new Response(
        JSON.stringify({
          code: 'knowledge_fs_access_denied',
          message: 'You do not have permission to perform this KnowledgeFS operation.',
          status: 403,
        }),
        { status: 403 },
      ),
    )
    renderForm({
      settings: {
        ...settings,
        retrieval: {
          ...settings.retrieval,
          score_threshold: {
            ...settings.retrieval.score_threshold,
            enabled: true,
          },
        },
      },
    })

    const thresholdInput = screen.getByRole('textbox', {
      name: 'appDebug.datasetConfig.score_threshold',
    })
    await user.clear(thresholdInput)
    await user.type(thresholdInput, '0.72')
    await user.tab()

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('dataset.newKnowledge.permissionRestricted'),
    )
    expect(screen.queryByText('dataset.newKnowledge.permissionRestricted')).not.toBeInTheDocument()
    expect(thresholdInput).toHaveValue('0.72')
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
    const rerankSelector = screen.getByRole('button', {
      name: 'common.modelProvider.rerankModel.key',
    })
    expect(rerankSelector).toHaveAccessibleDescription(
      'dataset.newKnowledge.settings.rerankModelRequired',
    )
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
      screen.getByRole('button', {
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
    const user = userEvent.setup()
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
    await user.click(reasoningSelector)

    await waitFor(() => expect(serviceMock.patchSettings).toHaveBeenCalledOnce())
    expect(reasoningSelector).toBeEnabled()
    expect(rerankSelector).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'datasetSettings.form.name' })).toBeEnabled()
    expect(
      screen.getByRole('switch', { name: 'dataset.newKnowledge.apiAgentAccess' }),
    ).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(rerankSelector)

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
      expect(screen.queryByText('common.operation.saving')).not.toBeInTheDocument()

      fireEvent.change(
        screen.getByRole('textbox', {
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
      await waitFor(() =>
        expect(toastMock.success).toHaveBeenCalledWith('common.api.actionSuccess'),
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
    const reasoningSelector = screen.getByRole('button', {
      name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
    })
    expect(reasoningSelector).toHaveAccessibleDescription(
      'dataset.newKnowledge.settings.systemReasoningModelRequired',
    )
    const embeddingSelector = screen.getByRole('button', {
      name: 'dataset.newKnowledge.settings.embeddingModelLabel',
    })
    expect(embeddingSelector).toHaveAccessibleDescription(
      'dataset.newKnowledge.settings.embeddingModelRequired',
    )
    const rerankSelector = screen.getByRole('button', {
      name: 'common.modelProvider.rerankModel.key',
    })
    expect(rerankSelector).toHaveAccessibleDescription(
      'dataset.newKnowledge.settings.rerankModelRequired',
    )
    expect(
      screen.getByRole('switch', { name: 'dataset.newKnowledge.apiAgentAccess' }),
    ).not.toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('switch', { name: 'dataset.newKnowledge.workflowAccess' }),
    ).not.toHaveAttribute('aria-disabled', 'true')

    await user.click(
      screen.getByRole('button', {
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

  it('protects a delayed retrieval save from immediate navigation', async () => {
    renderForm()
    const destination = document.createElement('a')
    destination.href = '/datasets/new/space-1/sources'
    destination.textContent = 'Go to sources'
    document.body.append(destination)

    fireEvent.change(
      screen.getByRole('textbox', {
        name: 'dataset.newKnowledge.settings.topKLabel',
      }),
      { target: { value: '8' } },
    )
    fireEvent.click(destination)

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(routerMock.push).not.toHaveBeenCalled()
    destination.remove()
  })

  it('asks before browser back navigation while the form has unsaved changes', async () => {
    const user = userEvent.setup()
    const historyBack = vi.spyOn(globalThis.history, 'back').mockImplementation(() => {})
    try {
      renderForm()
      const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
      await user.clear(nameInput)
      await user.type(nameInput, 'Unsaved camera specs')

      act(() => globalThis.dispatchEvent(new PopStateEvent('popstate')))

      const dialog = await screen.findByRole('alertdialog')
      expect(historyBack).not.toHaveBeenCalled()
      await user.click(
        within(dialog).getByRole('button', {
          name: 'dataset.newKnowledge.discardDraftConfirm',
        }),
      )
      expect(historyBack).toHaveBeenCalledOnce()
    } finally {
      historyBack.mockRestore()
    }
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
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
      }),
    ).toBeInTheDocument()
  })

  it('splits a canonical model provider before saving Knowledge FS settings', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(
      screen.getByRole('button', {
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
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
      }),
    )

    expect(screen.queryByText('common.operation.saving')).not.toBeInTheDocument()
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

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('common.api.actionSuccess'))
    expect(screen.queryByText('common.operation.saving')).not.toBeInTheDocument()
  })

  it('shows an error toast when a durable profile migration fails', async () => {
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
      screen.getByRole('button', {
        name: 'dataset.newKnowledge.settings.systemReasoningModelLabel',
      }),
    )

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('dataset.newKnowledge.settings.saveFailed'),
    )
    expect(screen.queryByText('dataset.newKnowledge.settings.saveFailed')).not.toBeInTheDocument()
    expect(toastMock.success).not.toHaveBeenCalled()
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
      screen.getByRole('button', { name: /datasetSettings\.form\.permissionsOnlyMe/ }),
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
