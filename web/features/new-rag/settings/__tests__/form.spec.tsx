import type {
  KnowledgeFsExternalAccessPayload,
  KnowledgeFsMembersReplacePayload,
  KnowledgeFsPermissionResponse,
  KnowledgeFsProfileMigrationResponse,
  KnowledgeFsSettingsPayload,
  KnowledgeFsSettingsResponse,
  KnowledgeFsSpaceDetailResponse,
  KnowledgeFsSpaceUpdatePayload,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ReactNode } from 'react'
import type { Member } from '@/models/common'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { queryClientAtom } from 'jotai-tanstack-query'
import { useHydrateAtoms } from 'jotai/utils'
import { render } from '@/test/console/render'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { KnowledgeSettingsPage } from '../page'

const serviceMock = vi.hoisted(() => ({
  deleteSpace: vi.fn(),
  getMigration: vi.fn(),
  getSpace: vi.fn(),
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

const knowledgeQueryMock = vi.hoisted(() => ({
  externalAccess: undefined as unknown,
  permissions: { data: [] } as unknown,
  settings: undefined as unknown,
  space: undefined as unknown,
}))

const membersQueryMock = vi.hoisted(() => ({
  data: { accounts: [] as Member[] },
  isError: false,
  isPending: false,
  refetch: vi.fn(() => Promise.resolve()),
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
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/service/use-common', () => ({
  useMembers: () => membersQueryMock,
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    workspaces: {
      current: {
        models: {
          modelTypes: {
            byModelType: {
              get: {
                queryOptions: ({
                  input,
                  select,
                }: {
                  input: { params: { model_type: string } }
                  select: (response: { data: never[] }) => never[]
                }) => ({
                  queryKey: ['models', input.params.model_type],
                  queryFn: async () => ({ data: [] }),
                  select,
                }),
              },
            },
          },
        },
      },
    },
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
            get: {
              key: () => queryKeys.externalAccess,
              queryOptions: (options?: { staleTime?: number }) => ({
                queryFn: () => Promise.resolve(knowledgeQueryMock.externalAccess),
                queryKey: queryKeys.externalAccess,
                staleTime: options?.staleTime ?? Infinity,
              }),
            },
            put: {
              mutationOptions: () => ({ mutationFn: serviceMock.patchExternalAccess }),
            },
          },
          get: {
            key: () => queryKeys.space,
            queryOptions: (options?: { staleTime?: number }) => ({
              queryFn: () => serviceMock.getSpace(),
              queryKey: queryKeys.space,
              staleTime: options?.staleTime ?? Infinity,
            }),
          },
          members: {
            put: {
              mutationOptions: () => ({ mutationFn: serviceMock.replaceMembers }),
            },
          },
          patch: {
            mutationOptions: () => ({ mutationFn: serviceMock.patchSpace }),
          },
          permissions: {
            get: {
              key: () => queryKeys.permissions,
              queryOptions: (options?: { staleTime?: number }) => ({
                queryFn: () => Promise.resolve(knowledgeQueryMock.permissions),
                queryKey: queryKeys.permissions,
                staleTime: options?.staleTime ?? Infinity,
              }),
            },
          },
          settings: {
            get: {
              key: () => queryKeys.settings,
              queryOptions: (options?: { staleTime?: number }) => ({
                queryFn: () => Promise.resolve(knowledgeQueryMock.settings),
                queryKey: queryKeys.settings,
                staleTime: options?.staleTime ?? Infinity,
              }),
            },
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

vi.mock('@/app/notifications', () => ({
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
  permissions = [],
  queryClient: queryClientOverride,
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
  permissions?: KnowledgeFsPermissionResponse[]
  queryClient?: QueryClient
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
  knowledgeQueryMock.externalAccess = externalAccessOverride
  knowledgeQueryMock.permissions = { data: permissions }
  knowledgeQueryMock.settings = settingsOverride
  knowledgeQueryMock.space = spaceOverride
  membersQueryMock.data = { accounts: members }
  queryClient.setQueryData(queryKeys.externalAccess, externalAccessOverride)
  queryClient.setQueryData(queryKeys.permissions, { data: permissions })
  queryClient.setQueryData(queryKeys.settings, settingsOverride)
  queryClient.setQueryData(queryKeys.space, spaceOverride)
  const Wrapper = ({ children }: { children: ReactNode }) => {
    useHydrateAtoms([[queryClientAtom, queryClient]], { dangerouslyForceHydrate: true })
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return {
    queryClient,
    ...render(<KnowledgeSettingsPage knowledgeSpaceId="space-1" />, { wrapper: Wrapper }),
  }
}

function acceptSettingsMigration(migration: KnowledgeFsProfileMigrationResponse) {
  const save = serviceMock.patchSettings.getMockImplementation()!
  serviceMock.patchSettings.mockImplementationOnce(async (...args) => ({
    ...(await save(...args)),
    migration,
  }))
}

function expectNoWrites() {
  expect(serviceMock.patchSpace).not.toHaveBeenCalled()
  expect(serviceMock.replaceMembers).not.toHaveBeenCalled()
  expect(serviceMock.patchExternalAccess).not.toHaveBeenCalled()
  expect(serviceMock.patchSettings).not.toHaveBeenCalled()
}

async function saveChanges(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'knowledgeSpace.settings.saveChanges' }))
}

const teamMember = {
  avatar: '',
  avatar_url: null,
  email: 'member@example.com',
  id: 'member-1',
  name: 'Team Member',
  role: 'normal',
  roles: [],
  status: 'active',
} satisfies Member

async function editAllSettings(user: ReturnType<typeof userEvent.setup>) {
  const name = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
  const description = screen.getByRole('textbox', { name: 'datasetSettings.form.desc' })
  await user.clear(name)
  await user.type(name, 'Draft camera specs')
  expectNoWrites()
  await user.clear(description)
  await user.type(description, 'Draft documentation')
  expectNoWrites()
  await user.click(screen.getByRole('button', { name: 'datasetSettings.form.nameAndIcon' }))
  await user.click(screen.getByRole('button', { name: 'Select camera style' }))
  expectNoWrites()
  await user.click(screen.getByRole('button', { name: /datasetSettings\.form\.permissionsOnlyMe/ }))
  const picker = screen.getByRole('dialog', { name: 'datasetSettings.form.permissions' })
  await user.click(
    within(picker).getByRole('radio', { name: 'datasetSettings.form.permissionsInvitedMembers' }),
  )
  await user.click(within(picker).getByRole('button', { name: /Team Member/ }))
  await user.keyboard('{Escape}')
  expectNoWrites()
  for (const name of ['knowledgeSpace.apiAgentAccess', 'knowledgeSpace.workflowAccess']) {
    await user.click(screen.getByRole('switch', { name }))
    expectNoWrites()
  }
  for (const name of [
    'knowledgeSpace.settings.systemReasoningModelLabel',
    'common.modelProvider.rerankModel.key',
  ]) {
    await user.click(screen.getByRole('button', { name }))
    expectNoWrites()
  }
  await user.click(screen.getByText('knowledgeSpace.settings.retrievalMode.deep'))
  expectNoWrites()
  const topK = screen.getByRole('textbox', { name: 'knowledgeSpace.settings.topKLabel' })
  await user.clear(topK)
  await user.type(topK, '8')
  await user.tab()
  expectNoWrites()
  await user.click(screen.getByRole('switch', { name: 'appDebug.datasetConfig.score_threshold' }))
  const threshold = screen.getByRole('textbox', { name: 'appDebug.datasetConfig.score_threshold' })
  await user.clear(threshold)
  await user.type(threshold, '0.72')
  await user.tab()
  expectNoWrites()
  return { name, description, topK, threshold }
}

describe('KnowledgeSettingsPage workflows', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    membersQueryMock.refetch.mockResolvedValue(undefined)
    serviceMock.deleteSpace.mockResolvedValue(undefined)
    serviceMock.getSpace.mockImplementation(async () => knowledgeQueryMock.space)
    serviceMock.patchExternalAccess.mockImplementation(
      async ({ body }: { body: KnowledgeFsExternalAccessPayload }) => {
        const current = knowledgeQueryMock.externalAccess as typeof externalAccess
        const saved = { ...current, ...body, revision: current.revision + 1 }
        knowledgeQueryMock.externalAccess = saved
        return saved
      },
    )
    serviceMock.patchSettings.mockImplementation(
      async ({ body }: { body: KnowledgeFsSettingsPayload }) => {
        const current = knowledgeQueryMock.settings as KnowledgeFsSettingsResponse
        const saved: KnowledgeFsSettingsResponse = {
          ...current,
          embedding: body.embedding
            ? {
                model: body.embedding.model,
                plugin_id: body.embedding.pluginId,
                provider: body.embedding.provider,
              }
            : current.embedding,
          retrieval: body.retrieval
            ? {
                default_mode: body.retrieval.defaultMode,
                reasoning_model: {
                  model: body.retrieval.reasoningModel.model,
                  plugin_id: body.retrieval.reasoningModel.pluginId,
                  provider: body.retrieval.reasoningModel.provider,
                },
                rerank: body.retrieval.rerank,
                score_threshold: body.retrieval.scoreThreshold,
                top_k: body.retrieval.topK,
              }
            : current.retrieval,
          revision: current.revision + 1,
        }
        knowledgeQueryMock.settings = saved
        return { settings: saved }
      },
    )
    serviceMock.patchSpace.mockImplementation(
      async ({ body }: { body: KnowledgeFsSpaceUpdatePayload }) => {
        const current = knowledgeQueryMock.space as KnowledgeFsSpaceDetailResponse
        const { visibility, ...basic } = body
        const saved = {
          ...current,
          resource_version: current.resource_version + 1,
          technical_summary: { ...current.technical_summary, ...basic },
          visibility: visibility ?? current.visibility,
        }
        knowledgeQueryMock.space = saved
        return saved
      },
    )
    serviceMock.replaceMembers.mockImplementation(
      async ({ body }: { body: KnowledgeFsMembersReplacePayload }) => {
        const saved = {
          data: body.members.map((member) => ({ ...member, revision: 1, status: 'active' })),
        }
        knowledgeQueryMock.permissions = saved
        return saved
      },
    )
  })

  it('keeps save disabled and shows an inline error when the name is empty', async () => {
    const user = userEvent.setup()
    renderForm()

    const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(nameInput)
    await user.tab()

    const nameError = screen.getByRole('alert')
    expect(nameError).toHaveTextContent('knowledgeSpace.settings.nameRequired')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAttribute('aria-describedby', nameError.id)
    expect(
      screen.getByRole('button', {
        name: 'knowledgeSpace.settings.saveChanges',
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
      name: 'knowledgeSpace.settings.saveChanges',
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

  it('keeps fields locked while Cancel refreshes the saved server data', async () => {
    const user = userEvent.setup()
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
    serviceMock.getSpace.mockReturnValueOnce(refreshPromise.then(() => knowledgeQueryMock.space))
    renderForm({ queryClient })

    const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated without conflict flash')
    await user.click(
      screen.getByRole('button', {
        name: 'common.operation.cancel',
      }),
    )

    await waitFor(() => expect(serviceMock.getSpace).toHaveBeenCalledOnce())
    expect(nameInput).toBeDisabled()
    finishRefresh()
    await waitFor(() => expect(nameInput).toBeEnabled())
    expect(nameInput).toHaveValue('Camera Technical Spec')
    expectNoWrites()
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
        name: 'knowledgeSpace.settings.saveChanges',
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
        name: 'knowledgeSpace.settings.saveChanges',
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
      name: 'knowledgeSpace.settings.saveChanges',
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

    await user.click(screen.getByRole('switch', { name: 'knowledgeSpace.apiAgentAccess' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expectNoWrites()
    await saveChanges(user)

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
        name: 'knowledgeSpace.settings.saveChanges',
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
        embedding: null,
        retrieval: null,
        configuration_state: 'setup-required',
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
      name: 'knowledgeSpace.apiAgentAccess',
    })
    const workflowAccessSwitch = screen.getByRole('switch', {
      name: 'knowledgeSpace.workflowAccess',
    })
    expect(apiAccessSwitch).not.toHaveAttribute('aria-disabled', 'true')
    expect(workflowAccessSwitch).not.toHaveAttribute('aria-disabled', 'true')
    expect(apiAccessSwitch).toHaveAccessibleDescription(
      'knowledgeSpace.settings.apiAccessDescription',
    )

    await user.click(apiAccessSwitch)
    expectNoWrites()
    await saveChanges(user)

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

    expect(serviceMock.patchSettings).not.toHaveBeenCalled()
  })

  it('enables Workflow access independently and preserves API and MCP channels', async () => {
    const user = userEvent.setup()
    renderForm({
      externalAccess: {
        ...externalAccess,
        workflow_enabled: false,
        service_api_enabled: false,
      },
    })

    const workflowAccessSwitch = screen.getByRole('switch', {
      name: 'knowledgeSpace.workflowAccess',
    })
    expect(workflowAccessSwitch).toHaveAttribute('aria-checked', 'false')
    expect(workflowAccessSwitch).toHaveAccessibleDescription(
      'knowledgeSpace.settings.workflowAccessDescription',
    )
    await user.click(workflowAccessSwitch)
    expectNoWrites()
    await saveChanges(user)

    await waitFor(() => {
      expect(serviceMock.patchExternalAccess).toHaveBeenCalledWith(
        {
          body: {
            agent_enabled: true,
            mcp_enabled: true,
            service_api_enabled: false,
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
      name: 'knowledgeSpace.workflowAccess',
    })
    await user.click(workflowAccessSwitch)
    expectNoWrites()
    await saveChanges(user)

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('knowledgeSpace.settings.saveFailed'),
    )
    expect(workflowAccessSwitch).toHaveAttribute('aria-checked', 'true')
    await saveChanges(user)
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledOnce())
    expect(serviceMock.patchExternalAccess).toHaveBeenCalledTimes(2)
    expect(workflowAccessSwitch).toHaveAttribute('aria-checked', 'true')
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
      name: 'knowledgeSpace.apiAgentAccess',
    })
    expect(apiAccessSwitch).toHaveAttribute('aria-checked', 'false')
    await user.click(apiAccessSwitch)
    expectNoWrites()
    await saveChanges(user)

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('knowledgeSpace.settings.saveFailed'),
    )
    expect(apiAccessSwitch).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(apiAccessSwitch).toHaveAttribute('aria-checked', 'false')
    expect(serviceMock.patchExternalAccess).toHaveBeenCalledOnce()
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
      name: /^knowledgeSpace\.settings\.deleteConfirmPrompt/,
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
    expect(routerMock.replace).toHaveBeenCalledWith('/datasets?view=agent')
  })

  it('keeps edits and shows a standard error toast after saving fails', async () => {
    const user = userEvent.setup()
    serviceMock.patchSpace.mockRejectedValueOnce(new Error('network error'))
    renderForm()

    const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Camera specs draft')
    const saveButton = screen.getByRole('button', {
      name: 'knowledgeSpace.settings.saveChanges',
    })
    await user.click(saveButton)

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('knowledgeSpace.settings.saveFailed'),
    )
    expect(nameInput).toHaveValue('Camera specs draft')
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
        name: 'knowledgeSpace.settings.systemReasoningModelLabel',
      }),
    )

    expectNoWrites()
    await saveChanges(user)

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('knowledgeSpace.settings.saveFailed'),
    )
    expect(serviceMock.patchSpace).not.toHaveBeenCalled()
  })

  it('shows a specific busy message without discarding the selected model', async () => {
    const user = userEvent.setup()
    serviceMock.patchSettings.mockRejectedValueOnce(
      new Response(
        JSON.stringify({
          failure: {
            code: 'KNOWLEDGE_SPACE_SETTINGS_COMPILATION_IN_PROGRESS',
            category: 'conflict',
            retryPolicy: 'manual',
            message: 'internal details',
          },
        }),
        { status: 409 },
      ),
    )
    renderForm()
    const selector = screen.getByRole('button', {
      name: 'knowledgeSpace.settings.systemReasoningModelLabel',
    })
    await user.click(selector)
    expectNoWrites()
    await saveChanges(user)

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('knowledgeSpace.settings.compilationInProgress'),
    )
    expect(selector).toHaveTextContent('openrouter/auto')
    expect(selector).toBeEnabled()
    expect(serviceMock.patchSettings).toHaveBeenCalledTimes(1)
    expect(serviceMock.patchSpace).not.toHaveBeenCalled()
  })

  it('requires an explicit reload on revision conflict before saving against the latest settings', async () => {
    const user = userEvent.setup()
    serviceMock.patchSettings.mockRejectedValueOnce(
      new Response(
        JSON.stringify({
          failure: {
            code: 'KNOWLEDGE_SPACE_SETTINGS_REVISION_CONFLICT',
            category: 'conflict',
            retryPolicy: 'manual',
            message: 'private conflict details',
          },
        }),
        { status: 409 },
      ),
    )
    renderForm()
    const selector = screen.getByRole('button', {
      name: 'knowledgeSpace.settings.systemReasoningModelLabel',
    })
    await user.click(selector)
    expectNoWrites()
    await saveChanges(user)
    const reload = await screen.findByRole('button', {
      name: 'knowledgeSpace.settings.reloadLatest',
    })
    expect(selector).toBeDisabled()
    expect(selector).toHaveTextContent('openrouter/auto')
    await user.click(selector)
    expect(serviceMock.patchSettings).toHaveBeenCalledTimes(1)

    knowledgeQueryMock.settings = {
      ...settings,
      revision: 8,
      retrieval: { ...settings.retrieval, top_k: 7 },
    }
    await user.click(reload)
    await waitFor(() => expect(selector).toBeEnabled())
    expect(selector).not.toHaveTextContent('openrouter/auto')
    expect(serviceMock.patchSettings).toHaveBeenCalledTimes(1)
    await user.click(selector)
    await saveChanges(user)
    await waitFor(() => expect(serviceMock.patchSettings).toHaveBeenCalledTimes(2))
    expect(serviceMock.patchSettings.mock.calls[1]?.[0].body).toMatchObject({
      expectedRevision: 8,
      retrieval: { topK: 7 },
    })
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
    expect(error).toHaveTextContent('knowledgeSpace.settings.membersRequired')
    expect(trigger).toHaveAttribute('aria-invalid', 'true')
    expect(trigger).toHaveAttribute('aria-describedby', error.id)
    expect(
      screen.getByRole('button', { name: 'knowledgeSpace.settings.saveChanges' }),
    ).toBeDisabled()
  })

  it('clamps retrieval values and shows their supported ranges', async () => {
    const user = userEvent.setup()
    renderForm()

    const topKInput = screen.getByRole('textbox', {
      name: 'knowledgeSpace.settings.topKLabel',
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
    expect(screen.getByText('knowledgeSpace.settings.topKMinimum')).toBeInTheDocument()
    expect(screen.getByText('knowledgeSpace.settings.scoreRange')).toBeInTheDocument()
    expectNoWrites()
    await saveChanges(user)

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
    expectNoWrites()
    await saveChanges(user)

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

  it('keeps a confirmed embedding model as a draft until the unified Save', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.settings.embeddingModelLabel',
      }),
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(serviceMock.patchSettings).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.confirm' }))
    expectNoWrites()
    await saveChanges(user)

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
        name: 'knowledgeSpace.settings.saveChanges',
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

    await user.click(screen.getByText('knowledgeSpace.settings.retrievalMode.deep'))
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
    expectNoWrites()
    await saveChanges(user)

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('knowledgeSpace.permissionRestricted'),
    )
    expect(thresholdInput).toHaveValue('0.72')
  })

  it('requires a rerank model for a legacy knowledge base and saves it as enabled', async () => {
    const user = userEvent.setup()
    acceptSettingsMigration({
      changed_kind: 'retrieval',
      checkpoint: 'queued',
      created_at: '2026-07-28T00:00:00Z',
      id: 'migration-rerank-1',
      knowledge_space_id: 'knowledge-1',
      rebuild_scope: 'clone-publication',
      run_state: 'queued',
      updated_at: '2026-07-28T00:00:00Z',
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
      'knowledgeSpace.settings.rerankModelRequired',
    )
    await user.click(rerankSelector)
    expectNoWrites()
    await saveChanges(user)

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
    expect(screen.queryByText('knowledgeSpace.settings.rerankModelRequired')).toBeNull()
    await waitFor(() => expect(serviceMock.getMigration).toHaveBeenCalledOnce())
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('common.api.actionSuccess'))
  })

  it('blocks a stale draft after the server baseline changes and restores the latest value', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderForm()
    const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Version B')

    knowledgeQueryMock.space = {
      ...space,
      resource_version: space.resource_version + 1,
      technical_summary: { ...space.technical_summary, name: 'Version C' },
    }
    act(() => queryClient.setQueryData(queryKeys.space, knowledgeQueryMock.space))
    expect(nameInput).toHaveValue('Version B')
    expect(await screen.findByRole('status')).toHaveTextContent(
      'knowledgeSpace.settings.serverConflict',
    )
    expect(
      screen.getByRole('button', {
        name: 'knowledgeSpace.settings.saveChanges',
      }),
    ).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(nameInput).toHaveValue('Version C')
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
      name: 'knowledgeSpace.settings.systemReasoningModelLabel',
    })
    expect(reasoningSelector).toHaveAccessibleDescription(
      'knowledgeSpace.settings.systemReasoningModelRequired',
    )
    const embeddingSelector = screen.getByRole('button', {
      name: 'knowledgeSpace.settings.embeddingModelLabel',
    })
    expect(embeddingSelector).toHaveAccessibleDescription(
      'knowledgeSpace.settings.embeddingModelRequired',
    )
    const rerankSelector = screen.getByRole('button', {
      name: 'common.modelProvider.rerankModel.key',
    })
    expect(rerankSelector).toHaveAccessibleDescription(
      'knowledgeSpace.settings.rerankModelRequired',
    )
    expect(
      screen.getByRole('switch', { name: 'knowledgeSpace.apiAgentAccess' }),
    ).not.toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('switch', { name: 'knowledgeSpace.workflowAccess' }),
    ).not.toHaveAttribute('aria-disabled', 'true')

    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.settings.systemReasoningModelLabel',
      }),
    )
    expect(
      screen.queryByText('knowledgeSpace.settings.systemReasoningModelRequired'),
    ).not.toBeInTheDocument()
    expect(embeddingSelector).toBeEnabled()
    await user.click(embeddingSelector)
    expect(
      screen.queryByText('knowledgeSpace.settings.embeddingModelRequired'),
    ).not.toBeInTheDocument()
    expect(serviceMock.patchSettings).not.toHaveBeenCalled()
    await user.click(rerankSelector)
    expect(
      screen.queryByText('knowledgeSpace.settings.rerankModelRequired'),
    ).not.toBeInTheDocument()

    expectNoWrites()
    await saveChanges(user)

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
      screen.getByRole('switch', { name: 'knowledgeSpace.apiAgentAccess' }),
    ).not.toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('switch', { name: 'knowledgeSpace.workflowAccess' }),
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
      name: 'knowledgeSpace.apiAgentAccess',
    })

    expect(apiAccessSwitch).not.toHaveAttribute('aria-disabled', 'true')
    expect(apiAccessSwitch).toHaveAccessibleDescription(
      'knowledgeSpace.settings.apiAccessDescription',
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

  it('does not protect unsaved changes from browser unload', async () => {
    const user = userEvent.setup()
    renderForm()

    const nameInput = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Unsaved camera specs')
    const event = new Event('beforeunload', { cancelable: true })
    globalThis.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
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
        name: 'knowledgeSpace.settings.systemReasoningModelLabel',
      }),
    ).toBeInTheDocument()
  })

  it('splits a canonical model provider before saving Knowledge FS settings', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.settings.systemReasoningModelLabel',
      }),
    )

    expectNoWrites()
    await saveChanges(user)

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
    acceptSettingsMigration({
      changed_kind: 'retrieval',
      checkpoint: 'queued',
      created_at: '2026-07-28T00:00:00Z',
      id: 'migration-1',
      knowledge_space_id: 'knowledge-1',
      rebuild_scope: 'clone-publication',
      run_state: 'queued',
      updated_at: '2026-07-28T00:00:00Z',
    })
    serviceMock.getMigration.mockReturnValueOnce(migrationPromise)
    renderForm()

    await user.click(
      screen.getByRole('button', {
        name: 'knowledgeSpace.settings.systemReasoningModelLabel',
      }),
    )

    expectNoWrites()
    await saveChanges(user)

    await waitFor(() => expect(serviceMock.getMigration).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
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
    acceptSettingsMigration({
      changed_kind: 'retrieval',
      checkpoint: 'evaluated',
      created_at: '2026-07-28T00:00:00Z',
      id: 'migration-1',
      knowledge_space_id: 'knowledge-1',
      rebuild_scope: 'clone-publication',
      run_state: 'running',
      updated_at: '2026-07-28T00:00:30Z',
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
        name: 'knowledgeSpace.settings.systemReasoningModelLabel',
      }),
    )

    expectNoWrites()
    await saveChanges(user)

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('knowledgeSpace.settings.saveFailed'),
    )
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('keeps every setting in draft and saves each changed resource once from the bottom action', async () => {
    const user = userEvent.setup()
    renderForm({ accountProfile: { id: 'owner-1' }, members: [teamMember] })
    const { name, description, topK, threshold } = await editAllSettings(user)
    const save = screen.getByRole('button', { name: 'knowledgeSpace.settings.saveChanges' })
    const cancel = screen.getByRole('button', { name: 'common.operation.cancel' })

    for (const content of [
      screen.getByRole('heading', { name: 'knowledgeSpace.settings.basicInfo' }),
      screen.getByRole('heading', { name: 'knowledgeSpace.settings.retrievalTitle' }),
      screen.getByRole('button', { name: 'common.operation.delete' }),
      threshold,
    ]) {
      expect(content.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
      expect(content.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    }
    expect(
      screen.getAllByRole('button', { name: 'knowledgeSpace.settings.saveChanges' }),
    ).toHaveLength(1)
    expectNoWrites()
    await user.click(save)

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledOnce())
    expect(serviceMock.patchSpace).toHaveBeenCalledExactlyOnceWith(
      {
        body: {
          name: 'Draft camera specs',
          description: 'Draft documentation',
          icon: 'camera',
          icon_background: '#FCE7F6',
          visibility: 'partial_members',
        },
        params: { control_space_id: 'space-1' },
      },
      expect.anything(),
    )
    expect(serviceMock.replaceMembers).toHaveBeenCalledExactlyOnceWith(
      {
        body: { members: [{ account_id: 'member-1', role: 'viewer' }] },
        params: { control_space_id: 'space-1' },
      },
      expect.anything(),
    )
    expect(serviceMock.patchExternalAccess).toHaveBeenCalledExactlyOnceWith(
      {
        body: {
          agent_enabled: false,
          service_api_enabled: false,
          workflow_enabled: false,
          mcp_enabled: true,
        },
        params: { control_space_id: 'space-1' },
      },
      expect.anything(),
    )
    expect(serviceMock.patchSettings).toHaveBeenCalledExactlyOnceWith(
      {
        body: {
          expectedRevision: 5,
          retrieval: {
            defaultMode: 'deep',
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
            scoreThreshold: { enabled: true, stage: 'rerank', value: 0.72 },
            topK: 8,
          },
        },
        params: { control_space_id: 'space-1' },
      },
      expect.anything(),
    )
    expect(name).toHaveValue('Draft camera specs')
    expect(description).toHaveValue('Draft documentation')
    expect(topK).toHaveValue('8')
    expect(threshold).toHaveValue('0.72')
    expect(save).toBeDisabled()
  })

  it('cancels basic, member, access, model and retrieval drafts together without writing', async () => {
    const user = userEvent.setup()
    renderForm({ accountProfile: { id: 'owner-1' }, members: [teamMember] })
    const { name, description, topK, threshold } = await editAllSettings(user)
    await user.click(
      screen.getByRole('button', { name: 'knowledgeSpace.settings.embeddingModelLabel' }),
    )
    const confirmation = await screen.findByRole('alertdialog')
    await user.click(within(confirmation).getByRole('button', { name: 'common.operation.confirm' }))
    expectNoWrites()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(name).toHaveValue('Camera Technical Spec')
    expect(description).toHaveValue('Product documentation')
    expect(topK).toHaveValue('3')
    expect(threshold).toHaveValue('0.5')
    expect(threshold).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /datasetSettings\.form\.permissionsOnlyMe/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'knowledgeSpace.settings.systemReasoningModelLabel' }),
    ).toHaveTextContent('gpt-4o')
    expect(
      screen.getByRole('button', { name: 'knowledgeSpace.settings.embeddingModelLabel' }),
    ).toHaveTextContent('text-embedding-3-large')
    expect(
      screen.getByRole('button', { name: 'common.modelProvider.rerankModel.key' }),
    ).toHaveTextContent('rerank-v3')
    expect(screen.getByRole('switch', { name: 'knowledgeSpace.apiAgentAccess' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'knowledgeSpace.workflowAccess' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(
      screen.getByRole('switch', { name: 'appDebug.datasetConfig.score_threshold' }),
    ).toHaveAttribute('aria-checked', 'false')
    expect(
      screen.getByRole('button', { name: 'datasetSettings.form.nameAndIcon' }),
    ).toHaveTextContent('📷')
    expect(
      screen.getByRole('button', { name: 'knowledgeSpace.settings.saveChanges' }),
    ).toBeDisabled()
    expectNoWrites()
  })

  it('locks every section and already-open icon selection until the whole save finishes', async () => {
    const user = userEvent.setup()
    let finishSave!: () => void
    const originalSave = serviceMock.patchSpace.getMockImplementation()!
    serviceMock.patchSpace.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        finishSave = resolve
      })
      return originalSave(...args)
    })
    renderForm()
    const name = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(name)
    await user.type(name, 'Saving camera specs')
    await user.click(screen.getByRole('button', { name: 'datasetSettings.form.nameAndIcon' }))
    expect(screen.getByRole('button', { name: 'Select camera style' })).toBeInTheDocument()
    await saveChanges(user)
    await waitFor(() => expect(serviceMock.patchSpace).toHaveBeenCalledOnce())

    for (const label of [
      'datasetSettings.form.name',
      'datasetSettings.form.desc',
      'knowledgeSpace.settings.topKLabel',
      'appDebug.datasetConfig.score_threshold',
    ])
      expect(screen.getByRole('textbox', { name: label })).toBeDisabled()
    for (const label of [
      'datasetSettings.form.nameAndIcon',
      'knowledgeSpace.settings.systemReasoningModelLabel',
      'knowledgeSpace.settings.embeddingModelLabel',
      'common.modelProvider.rerankModel.key',
      'common.operation.cancel',
      'common.operation.delete',
    ])
      expect(screen.getByRole('button', { name: label })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /datasetSettings\.form\.permissionsOnlyMe/ }),
    ).toBeDisabled()
    for (const label of [
      'knowledgeSpace.apiAgentAccess',
      'knowledgeSpace.workflowAccess',
      'appDebug.datasetConfig.score_threshold',
    ])
      expect(screen.getByRole('switch', { name: label })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('switch', { name: 'knowledgeSpace.apiAgentAccess' }))
    await user.click(
      screen.getByRole('button', { name: 'knowledgeSpace.settings.systemReasoningModelLabel' }),
    )
    const openIconChoice = screen.queryByRole('button', { name: 'Select camera style' })
    if (openIconChoice) await user.click(openIconChoice)
    expect(serviceMock.patchExternalAccess).not.toHaveBeenCalled()
    expect(serviceMock.patchSettings).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'datasetSettings.form.nameAndIcon' }),
    ).toHaveTextContent('📷')

    finishSave()
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledOnce())
    expect(name).toBeEnabled()
    expect(name).toHaveValue('Saving camera specs')
    expect(serviceMock.patchSpace).toHaveBeenCalledOnce()
  })

  it('preserves all local drafts on a retrieval refetch conflict and cancels to the latest snapshot', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderForm()
    const name = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    const topK = screen.getByRole('textbox', { name: 'knowledgeSpace.settings.topKLabel' })
    const workflow = screen.getByRole('switch', { name: 'knowledgeSpace.workflowAccess' })
    await user.clear(name)
    await user.type(name, 'Local name')
    await user.click(workflow)
    await user.clear(topK)
    await user.type(topK, '8')
    await user.tab()
    knowledgeQueryMock.settings = {
      ...settings,
      revision: 8,
      retrieval: { ...settings.retrieval, top_k: 6 },
    }
    act(() => queryClient.setQueryData(queryKeys.settings, knowledgeQueryMock.settings))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'knowledgeSpace.settings.serverConflict',
    )
    expect(name).toHaveValue('Local name')
    expect(workflow).toHaveAttribute('aria-checked', 'false')
    expect(topK).toHaveValue('8')
    expect(
      screen.getByRole('button', { name: 'knowledgeSpace.settings.saveChanges' }),
    ).toBeDisabled()
    expectNoWrites()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(name).toHaveValue('Camera Technical Spec')
    expect(workflow).toHaveAttribute('aria-checked', 'true')
    expect(topK).toHaveValue('6')
    expectNoWrites()
  })

  it('saves embedding first, waits for activation and uses the fresh revision for the remaining retrieval draft', async () => {
    const user = userEvent.setup()
    let finishMigration!: () => void
    const originalSave = serviceMock.patchSettings.getMockImplementation()!
    const migration = {
      changed_kind: 'embedding' as const,
      checkpoint: 'queued' as const,
      created_at: '2026-07-28T00:00:00Z',
      id: 'embedding-migration-1',
      knowledge_space_id: 'knowledge-1',
      rebuild_scope: 'full-vector-space' as const,
      run_state: 'queued' as const,
      updated_at: '2026-07-28T00:00:00Z',
    }
    serviceMock.patchSettings.mockImplementationOnce(async (...args) => ({
      ...(await originalSave(...args)),
      migration,
    }))
    serviceMock.getMigration.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finishMigration = resolve
      })
      knowledgeQueryMock.settings = {
        ...(knowledgeQueryMock.settings as KnowledgeFsSettingsResponse),
        revision: 9,
      }
      return { ...migration, checkpoint: 'activated', run_state: 'succeeded' }
    })
    renderForm()
    await user.click(
      screen.getByRole('button', { name: 'knowledgeSpace.settings.embeddingModelLabel' }),
    )
    const confirmation = await screen.findByRole('alertdialog')
    await user.click(within(confirmation).getByRole('button', { name: 'common.operation.confirm' }))
    expectNoWrites()
    await user.click(
      screen.getByRole('button', { name: 'knowledgeSpace.settings.systemReasoningModelLabel' }),
    )
    const topK = screen.getByRole('textbox', { name: 'knowledgeSpace.settings.topKLabel' })
    await user.clear(topK)
    await user.type(topK, '8')
    await user.tab()
    expectNoWrites()
    await saveChanges(user)

    await waitFor(() => expect(serviceMock.getMigration).toHaveBeenCalledOnce())
    expect(serviceMock.patchSettings).toHaveBeenCalledExactlyOnceWith(
      {
        body: {
          expectedRevision: 5,
          embedding: {
            model: 'openrouter/auto',
            pluginId: 'langgenius/openrouter',
            provider: 'openrouter',
          },
        },
        params: { control_space_id: 'space-1' },
      },
      expect.anything(),
    )
    expect(topK).toBeDisabled()
    expect(toastMock.success).not.toHaveBeenCalled()
    finishMigration()

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledOnce())
    expect(serviceMock.patchSettings).toHaveBeenCalledTimes(2)
    expect(serviceMock.patchSettings).toHaveBeenNthCalledWith(
      2,
      {
        body: {
          expectedRevision: 9,
          retrieval: expect.objectContaining({
            topK: 8,
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
    expect(topK).toHaveValue('8')
    expect(topK).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'knowledgeSpace.settings.saveChanges' }),
    ).toBeDisabled()
  })

  it('retries only the unsaved resource after a partial save and keeps the desired draft', async () => {
    const user = userEvent.setup()
    serviceMock.patchExternalAccess.mockImplementationOnce(async () => {
      const saved = knowledgeQueryMock.space as KnowledgeFsSpaceDetailResponse
      knowledgeQueryMock.space = {
        ...saved,
        resource_version: saved.resource_version + 1,
        technical_summary: {
          ...saved.technical_summary,
          description: 'Updated by another administrator',
        },
      }
      throw new Error('access temporarily unavailable')
    })
    renderForm()
    const name = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    const api = screen.getByRole('switch', { name: 'knowledgeSpace.apiAgentAccess' })
    await user.clear(name)
    await user.type(name, 'Saved before access failure')
    await user.click(api)
    expectNoWrites()
    await saveChanges(user)

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledOnce())
    expect(serviceMock.patchSpace).toHaveBeenCalledOnce()
    expect(serviceMock.patchExternalAccess).toHaveBeenCalledOnce()
    expect(name).toHaveValue('Saved before access failure')
    expect(screen.getByRole('textbox', { name: 'datasetSettings.form.desc' })).toHaveValue(
      'Updated by another administrator',
    )
    expect(api).toHaveAttribute('aria-checked', 'false')
    expect(
      screen.getByRole('button', { name: 'knowledgeSpace.settings.saveChanges' }),
    ).toBeEnabled()
    await saveChanges(user)

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledOnce())
    expect(serviceMock.patchSpace).toHaveBeenCalledOnce()
    expect(serviceMock.patchExternalAccess).toHaveBeenCalledTimes(2)
    expect(name).toHaveValue('Saved before access failure')
    expect(screen.getByRole('textbox', { name: 'datasetSettings.form.desc' })).toHaveValue(
      'Updated by another administrator',
    )
    expect(api).toHaveAttribute('aria-checked', 'false')
  })

  it('retains drafts when Cancel cannot refresh the saved data and discards them after a successful retry', async () => {
    const user = userEvent.setup()
    renderForm()
    const name = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    await user.clear(name)
    await user.type(name, 'Keep this draft until refresh succeeds')
    serviceMock.getSpace.mockRejectedValueOnce(new Error('refresh unavailable'))
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledOnce())
    expect(name).toHaveValue('Keep this draft until refresh succeeds')
    expectNoWrites()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(name).toHaveValue('Camera Technical Spec'))
    expect(
      screen.getByRole('button', { name: 'knowledgeSpace.settings.saveChanges' }),
    ).toBeDisabled()
    expectNoWrites()
  })

  it('accepts a background refresh without conflict after every edit is restored to its saved value', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderForm()
    const name = screen.getByRole('textbox', { name: 'datasetSettings.form.name' })
    const workflow = screen.getByRole('switch', { name: 'knowledgeSpace.workflowAccess' })
    const topK = screen.getByRole('textbox', { name: 'knowledgeSpace.settings.topKLabel' })
    await user.clear(name)
    await user.type(name, 'Temporary title')
    await user.click(workflow)
    await user.clear(topK)
    await user.type(topK, '8')
    await user.tab()
    await user.clear(name)
    await user.type(name, 'Camera Technical Spec')
    await user.click(workflow)
    await user.clear(topK)
    await user.type(topK, '3')
    await user.tab()
    expectNoWrites()

    act(() => {
      queryClient.setQueryData(queryKeys.space, {
        ...space,
        resource_version: 4,
        technical_summary: { ...space.technical_summary, name: 'Latest server name' },
      })
      queryClient.setQueryData(queryKeys.settings, {
        ...settings,
        revision: 6,
        retrieval: { ...settings.retrieval, top_k: 7 },
      })
    })
    await waitFor(() => expect(name).toHaveValue('Latest server name'))
    expect(topK).toHaveValue('7')
    expect(screen.queryByText('knowledgeSpace.settings.serverConflict')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'knowledgeSpace.settings.saveChanges' }),
    ).toBeDisabled()
    expectNoWrites()
  })

  it('retries observation of an accepted migration without submitting the settings mutation twice', async () => {
    const user = userEvent.setup()
    const migration = {
      changed_kind: 'retrieval' as const,
      checkpoint: 'queued' as const,
      created_at: '2026-07-28T00:00:00Z',
      id: 'migration-recover-1',
      knowledge_space_id: 'knowledge-1',
      rebuild_scope: 'clone-publication' as const,
      run_state: 'queued' as const,
      updated_at: '2026-07-28T00:00:00Z',
    }
    acceptSettingsMigration(migration)
    serviceMock.getMigration
      .mockRejectedValueOnce(new Error('migration poll interrupted'))
      .mockResolvedValueOnce({ ...migration, checkpoint: 'activated', run_state: 'succeeded' })
    renderForm()
    const reasoning = screen.getByRole('button', {
      name: 'knowledgeSpace.settings.systemReasoningModelLabel',
    })
    await user.click(reasoning)
    expectNoWrites()
    await saveChanges(user)

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledOnce())
    expect(reasoning).toHaveTextContent('openrouter/auto')
    expect(serviceMock.patchSettings).toHaveBeenCalledOnce()
    expect(
      screen.getByRole('button', { name: 'knowledgeSpace.settings.saveChanges' }),
    ).toBeEnabled()
    await saveChanges(user)

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledOnce())
    expect(serviceMock.patchSettings).toHaveBeenCalledOnce()
    expect(serviceMock.getMigration).toHaveBeenCalledTimes(2)
    expect(serviceMock.getMigration).toHaveBeenLastCalledWith({
      params: { control_space_id: 'space-1', migration_id: 'migration-recover-1' },
    })
    expect(reasoning).toHaveTextContent('openrouter/auto')
    expect(
      screen.getByRole('button', { name: 'knowledgeSpace.settings.saveChanges' }),
    ).toBeDisabled()
  })

  it('fully locks the page for a view-only user', () => {
    renderForm({
      space: {
        ...space,
        permission_keys: ['knowledge_space_read'],
      },
    })

    expect(screen.getByText('knowledgeSpace.settings.viewOnly')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'datasetSettings.form.name' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /datasetSettings\.form\.permissionsOnlyMe/ }),
    ).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'knowledgeSpace.apiAgentAccess' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('switch', { name: 'knowledgeSpace.workflowAccess' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(
      screen.queryByRole('button', {
        name: 'knowledgeSpace.settings.saveChanges',
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'common.operation.delete' }),
    ).not.toBeInTheDocument()
  })

  it('lets an access-config-only user update members and external access', async () => {
    const user = userEvent.setup()
    const member = {
      avatar: '',
      avatar_url: null,
      email: 'member@example.com',
      id: 'member-1',
      name: 'Team Member',
      role: 'normal',
      roles: [],
      status: 'active',
    } satisfies Member
    renderForm({
      members: [member],
      space: {
        ...space,
        permission_keys: ['knowledge_space_access_config', 'knowledge_space_read'],
        visibility: 'partial_members',
      },
    })

    expect(screen.queryByText('knowledgeSpace.settings.viewOnly')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'datasetSettings.form.name' })).toBeDisabled()
    expect(
      screen.getByRole('switch', { name: 'knowledgeSpace.apiAgentAccess' }),
    ).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('button', { name: /Test User/ }))
    const picker = screen.getByRole('dialog', { name: 'datasetSettings.form.permissions' })
    expect(
      within(picker).getByRole('radio', {
        name: /datasetSettings\.form\.permissionsOnlyMe/,
      }),
    ).toBeDisabled()
    await user.click(within(picker).getByRole('button', { name: /Team Member/ }))
    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.settings.saveChanges' }))

    await waitFor(() =>
      expect(serviceMock.replaceMembers).toHaveBeenCalledWith(
        {
          body: { members: [{ account_id: 'member-1', role: 'viewer' }] },
          params: { control_space_id: 'space-1' },
        },
        expect.anything(),
      ),
    )
    expect(serviceMock.patchSpace).not.toHaveBeenCalled()
  })

  it('shows the destructive action to a delete-only user', () => {
    renderForm({
      space: {
        ...space,
        permission_keys: ['knowledge_space_delete', 'knowledge_space_read'],
      },
    })

    expect(screen.queryByText('knowledgeSpace.settings.viewOnly')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.delete' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'datasetSettings.form.name' })).toBeDisabled()
  })
})
