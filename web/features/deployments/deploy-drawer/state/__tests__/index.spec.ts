import type {
  CredentialCandidate,
  CredentialSlot,
  Environment,
  EnvironmentDeployment,
  EnvVarSlot,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import type { Getter } from 'jotai'
import {
  EnvVarValueSource,
  EnvVarValueType,
  PluginCategory,
  RuntimeInstanceStatus,
} from '@dify/contracts/enterprise/types.gen'
import { skipToken } from '@tanstack/react-query'
import { atom, createStore } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type QueryOptions = {
  data?: unknown
  enabled?: boolean
  input?: unknown
  isError?: boolean
  isFetching?: boolean
  isLoading?: boolean
  queryKey?: readonly unknown[]
  retry?: boolean
}

type QueryResult = {
  data?: {
    options: DeploymentOptions
  }
  isLoading: boolean
  isFetching: boolean
  isError: boolean
}

type DeploymentOptions = {
  credentialSlots: CredentialSlot[]
  envVarSlots: EnvVarSlot[]
}

type MutationOptions = {
  mutationKey?: readonly string[]
}

type MutationResult = {
  isPending: boolean
  mutate: ReturnType<typeof vi.fn>
}

const mockDeploymentOptionsQuery = vi.hoisted<{ current: QueryResult }>(() => ({
  current: {
    isLoading: false,
    isFetching: false,
    isError: false,
  },
}))
const mockPromoteMutate = vi.hoisted(() => vi.fn())
const mockRollbackMutate = vi.hoisted(() => vi.fn())
const mockPromoteMutation = vi.hoisted<{ current: MutationResult }>(() => ({
  current: {
    isPending: false,
    mutate: mockPromoteMutate,
  },
}))
const mockRollbackMutation = vi.hoisted<{ current: MutationResult }>(() => ({
  current: {
    isPending: false,
    mutate: mockRollbackMutate,
  },
}))

vi.mock('jotai-tanstack-query', () => ({
  atomWithQuery: (createOptions: (get: Getter) => QueryOptions) =>
    atom((get) => {
      const options = createOptions(get)
      if (options.queryKey?.[0] === 'computeDeploymentOptions') {
        return {
          ...options,
          ...mockDeploymentOptionsQuery.current,
        }
      }

      return {
        ...options,
        data: undefined,
        isLoading: false,
        isFetching: false,
        isError: false,
      }
    }),
  atomWithMutation: (createOptions: () => MutationOptions) =>
    atom(() => {
      const options = createOptions()
      return options.mutationKey?.[0] === 'rollback'
        ? mockRollbackMutation.current
        : mockPromoteMutation.current
    }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      releaseService: {
        computeReleaseDeploymentView: {
          queryOptions: ({ enabled, input }: { enabled: boolean; input: unknown }) => ({
            enabled,
            input,
            queryKey: ['computeReleaseDeploymentView', input],
          }),
        },
        computeDeploymentOptions: {
          queryOptions: ({ enabled, input }: { enabled: boolean; input: unknown }) => ({
            enabled,
            input,
            queryKey: ['computeDeploymentOptions', input],
          }),
        },
      },
      deploymentService: {
        promote: {
          mutationOptions: () => ({ mutationKey: ['promote'] }),
        },
        rollback: {
          mutationOptions: () => ({ mutationKey: ['rollback'] }),
        },
      },
    },
  },
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('../../shared/domain/idempotency', () => ({
  createDeploymentIdempotencyKey: () => 'deploy-idempotency-key',
}))

async function loadState() {
  return await import('../index')
}

function environment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: 'environment-1',
    displayName: 'Production',
    description: '',
    mode: 'ENVIRONMENT_MODE_SHARED',
    backend: 'RUNTIME_BACKEND_K8S',
    status: 'ENVIRONMENT_STATUS_READY',
    statusMessage: '',
    cpuCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Environment
}

function release(overrides: Partial<Release> = {}): Release {
  return {
    id: 'release-1',
    appInstanceId: 'app-instance-1',
    displayName: 'Release 1',
    description: '',
    sourceAppId: 'source-app-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: {
      id: 'account-1',
      displayName: 'Owner',
    },
    ...overrides,
  } as Release
}

function credentialCandidate(overrides: Partial<CredentialCandidate> = {}): CredentialCandidate {
  return {
    credentialId: 'credential-1',
    providerId: 'langgenius/openai',
    category: PluginCategory.PLUGIN_CATEGORY_MODEL,
    displayName: 'Primary key',
    fromEnterprise: false,
    ...overrides,
  }
}

function credentialSlot(overrides: Partial<CredentialSlot> = {}): CredentialSlot {
  return {
    providerId: 'langgenius/openai',
    category: PluginCategory.PLUGIN_CATEGORY_MODEL,
    candidates: [
      credentialCandidate({ credentialId: 'credential-1' }),
      credentialCandidate({ credentialId: 'credential-2', displayName: 'Backup key' }),
    ],
    lastCredentialId: '',
    ...overrides,
  }
}

function envVarSlot(overrides: Partial<EnvVarSlot> = {}): EnvVarSlot {
  return {
    key: 'API_KEY',
    valueType: EnvVarValueType.ENV_VAR_VALUE_TYPE_STRING,
    description: '',
    ...overrides,
  }
}

function runtimeRow(overrides: Partial<EnvironmentDeployment> = {}): EnvironmentDeployment {
  return {
    environment: environment(),
    status: RuntimeInstanceStatus.RUNTIME_INSTANCE_STATUS_READY,
    currentRelease: release({ id: 'release-1', createdAt: '2026-01-01T00:00:00.000Z' }),
    desiredRelease: release({ id: 'release-1', createdAt: '2026-01-01T00:00:00.000Z' }),
    ...overrides,
  } as EnvironmentDeployment
}

function deployConfig() {
  return {
    appInstanceId: 'app-instance-1',
    environments: [
      environment({ id: 'environment-1', displayName: 'Production' }),
      environment({ id: 'environment-2', displayName: 'Staging' }),
    ],
    releases: [
      release({ id: 'release-2', displayName: 'Release 2', createdAt: '2026-01-02T00:00:00.000Z' }),
      release({ id: 'release-1', displayName: 'Release 1', createdAt: '2026-01-01T00:00:00.000Z' }),
    ],
    runtimeRows: [runtimeRow()],
    defaultReleaseId: 'release-2',
  }
}

function setQueryOptions(options: DeploymentOptions) {
  mockDeploymentOptionsQuery.current = {
    data: {
      options,
    },
    isLoading: false,
    isFetching: false,
    isError: false,
  }
}

describe('deploy drawer state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeploymentOptionsQuery.current = {
      isLoading: false,
      isFetching: false,
      isError: false,
    }
    mockPromoteMutation.current = {
      isPending: false,
      mutate: mockPromoteMutate,
    }
    mockRollbackMutation.current = {
      isPending: false,
      mutate: mockRollbackMutate,
    }
  })

  it('should open and close the deploy drawer with route identity', async () => {
    const state = await loadState()
    const store = createStore()

    store.set(state.openDeployDrawerAtom, {
      appInstanceId: 'app-instance-1',
      environmentId: 'environment-1',
      releaseId: 'release-2',
    })

    expect(store.get(state.deployDrawerOpenAtom)).toBe(true)
    expect(store.get(state.deployDrawerAppInstanceIdAtom)).toBe('app-instance-1')
    expect(store.get(state.deployDrawerEnvironmentIdAtom)).toBe('environment-1')
    expect(store.get(state.deployDrawerReleaseIdAtom)).toBe('release-2')

    store.set(state.closeDeployDrawerAtom)

    expect(store.get(state.deployDrawerOpenAtom)).toBe(false)
    expect(store.get(state.deployDrawerAppInstanceIdAtom)).toBeUndefined()
    expect(store.get(state.deployDrawerEnvironmentIdAtom)).toBeUndefined()
    expect(store.get(state.deployDrawerReleaseIdAtom)).toBeUndefined()
  })

  it('should disable release deployment view query with skipToken until form app instance exists', async () => {
    const state = await loadState()
    const store = createStore()

    expect(store.get(state.releaseDeploymentViewQueryAtom)).toMatchObject({
      enabled: false,
      input: skipToken,
    })

    store.set(state.deployFormAppInstanceIdAtom, 'app-instance-1')

    expect(store.get(state.releaseDeploymentViewQueryAtom)).toMatchObject({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
  })

  it('should derive default environment and release selections from config', async () => {
    const state = await loadState()
    const store = createStore()
    store.set(state.deployReadyFormConfigAtom, {
      ...deployConfig(),
      lockedEnvId: 'environment-2',
      presetReleaseId: 'release-1',
      releaseEmptyLabel: 'No releases',
    })

    expect(store.get(state.deploySelectedEnvironmentIdAtom)).toBe('environment-2')
    expect(store.get(state.deployLockedEnvironmentIdAtom)).toBe('environment-2')
    expect(store.get(state.deployLockedEnvironmentAtom)?.displayName).toBe('Staging')
    expect(store.get(state.deploySelectedReleaseIdAtom)).toBe('release-1')
    expect(store.get(state.deployDisplayedReleaseAtom)?.id).toBe('release-1')
    expect(store.get(state.deployIsExistingReleaseAtom)).toBe(true)
    expect(store.get(state.deployReleaseRowsAtom)).toHaveLength(2)
    expect(store.get(state.deployEnvironmentRowsAtom)).toHaveLength(2)
    expect(store.get(state.deployReleaseEmptyLabelAtom)).toBe('No releases')
    expect(store.get(state.deployHasSelectedEnvironmentAtom)).toBe(true)
  })

  it('should reset bindings, env vars, and validation state when target changes', async () => {
    const state = await loadState()
    const store = createStore()
    const slot = credentialSlot()
    store.set(state.deployReadyFormConfigAtom, deployConfig())
    setQueryOptions({
      credentialSlots: [slot],
      envVarSlots: [envVarSlot()],
    })

    store.set(
      state.selectDeployBindingAtom,
      'langgenius/openai:PLUGIN_CATEGORY_MODEL',
      'credential-1',
    )
    store.set(state.setDeployEnvVarAtom, 'API_KEY', {
      value: 'secret',
      valueSource: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL,
    })
    store.set(state.showDeployValidationErrorsAtom)

    expect(store.get(state.deploySelectedBindingsAtom)).toEqual({
      'langgenius/openai:PLUGIN_CATEGORY_MODEL': 'credential-1',
    })
    expect(store.get(state.deployEnvVarValuesAtom)).toEqual({
      API_KEY: {
        value: 'secret',
        valueSource: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL,
      },
    })
    expect(store.get(state.deployShowValidationErrorsAtom)).toBe(true)

    store.set(state.selectDeployEnvironmentAtom, 'environment-2')

    expect(store.get(state.deploySelectedEnvironmentIdAtom)).toBe('environment-2')
    expect(store.get(state.deploySelectedBindingsAtom)).toEqual({})
    expect(store.get(state.deployEnvVarValuesAtom)).toEqual({})
    expect(store.get(state.deployShowValidationErrorsAtom)).toBe(false)

    store.set(state.selectDeployReleaseAtom, 'release-1')
    expect(store.get(state.deploySelectedReleaseIdAtom)).toBe('release-1')
  })

  it('should derive binding and env var readiness from deployment options', async () => {
    const state = await loadState()
    const store = createStore()
    const slot = credentialSlot({
      lastCredentialId: 'credential-2',
    })
    store.set(state.deployReadyFormConfigAtom, deployConfig())
    setQueryOptions({
      credentialSlots: [slot],
      envVarSlots: [
        envVarSlot({
          key: 'PORT',
          valueType: EnvVarValueType.ENV_VAR_VALUE_TYPE_NUMBER,
          defaultValue: '8080',
        }),
      ],
    })

    expect(store.get(state.deployBindingSlotsAtom)).toEqual([slot])
    expect(store.get(state.deployEnvVarSlotsAtom)).toMatchObject([
      {
        key: 'PORT',
        valueType: 'number',
        hasDefaultValue: true,
        hasLastValue: false,
      },
    ])
    expect(store.get(state.deploySelectedBindingsAtom)).toEqual({
      'langgenius/openai:PLUGIN_CATEGORY_MODEL': 'credential-2',
    })
    expect(store.get(state.canAttemptDeployAtom)).toBe(true)
    expect(store.get(state.canSubmitDeployAtom)).toBe(true)
  })

  it('should block submit until required literal env vars are valid', async () => {
    const state = await loadState()
    const store = createStore()
    store.set(state.deployReadyFormConfigAtom, deployConfig())
    setQueryOptions({
      credentialSlots: [
        credentialSlot({
          candidates: [credentialCandidate({ credentialId: 'credential-1' })],
        }),
      ],
      envVarSlots: [
        envVarSlot({
          key: 'PORT',
          valueType: EnvVarValueType.ENV_VAR_VALUE_TYPE_NUMBER,
        }),
      ],
    })

    expect(store.get(state.canAttemptDeployAtom)).toBe(true)
    expect(store.get(state.canSubmitDeployAtom)).toBe(false)

    store.set(state.setDeployEnvVarAtom, 'PORT', {
      value: 'abc',
      valueSource: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL,
    })
    expect(store.get(state.canSubmitDeployAtom)).toBe(false)

    store.set(state.setDeployEnvVarAtom, 'PORT', {
      value: '3000',
      valueSource: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL,
    })
    expect(store.get(state.canSubmitDeployAtom)).toBe(true)
  })

  it('should submit a promote deployment with selected credentials and env vars', async () => {
    const state = await loadState()
    const store = createStore()
    mockPromoteMutate.mockImplementation(
      (_variables: unknown, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.()
      },
    )
    store.set(state.deployReadyFormConfigAtom, deployConfig())
    setQueryOptions({
      credentialSlots: [
        credentialSlot({
          candidates: [credentialCandidate({ credentialId: 'credential-1' })],
        }),
      ],
      envVarSlots: [
        envVarSlot({
          key: 'API_KEY',
          valueType: EnvVarValueType.ENV_VAR_VALUE_TYPE_SECRET,
        }),
      ],
    })
    store.set(state.setDeployEnvVarAtom, 'API_KEY', {
      value: 'secret',
      valueSource: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL,
    })

    store.set(state.deployReleaseSubmissionAtom, {
      deployFailedMessage: 'Deploy failed',
    })

    expect(mockPromoteMutate).toHaveBeenCalledWith(
      {
        params: {
          appInstanceId: 'app-instance-1',
          environmentId: 'environment-1',
        },
        body: {
          appInstanceId: 'app-instance-1',
          environmentId: 'environment-1',
          releaseId: 'release-2',
          credentials: [
            {
              providerId: 'langgenius/openai',
              category: PluginCategory.PLUGIN_CATEGORY_MODEL,
              credentialId: 'credential-1',
            },
          ],
          envVars: [
            {
              key: 'API_KEY',
              value: 'secret',
              valueSource: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL,
            },
          ],
          idempotencyKey: expect.any(String),
        },
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    )
    expect(store.get(state.deployDrawerOpenAtom)).toBe(false)
  })
})
