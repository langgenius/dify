import type {
  CredentialCandidate,
  CredentialSlot,
  Environment,
  EnvironmentDeployment,
  EnvVarSlot,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import {
  EnvVarValueSource,
  EnvVarValueType,
  PluginCategory,
  RuntimeInstanceStatus,
} from '@dify/contracts/enterprise/types.gen'
import { skipToken } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryAtomTestStore } from '@/test/query-atom'

type DeploymentOptions = {
  credentialSlots: CredentialSlot[]
  envVarSlots: EnvVarSlot[]
}

const mockReleaseDeploymentViewQueryOptions = vi.hoisted(() => vi.fn())
const mockPromoteMutation = vi.hoisted(() => vi.fn())
const mockRollbackMutation = vi.hoisted(() => vi.fn())

vi.mock('@/service/client', () => ({
  consoleQuery: {
    enterprise: {
      releaseService: {
        computeReleaseDeploymentView: {
          queryOptions: ({ enabled, input }: { enabled: boolean; input: unknown }) => {
            mockReleaseDeploymentViewQueryOptions({ enabled, input })
            return {
              enabled,
              input,
              queryKey: ['computeReleaseDeploymentView', input],
              queryFn: async () => undefined,
            }
          },
        },
        computeDeploymentOptions: {
          queryOptions: ({ enabled, input }: { enabled: boolean; input: unknown }) => ({
            enabled,
            input,
            queryKey: ['computeDeploymentOptions', input],
            queryFn: async () => undefined,
          }),
        },
      },
      deploymentService: {
        promote: {
          mutationOptions: () => ({
            mutationKey: ['promote'],
            mutationFn: mockPromoteMutation,
          }),
        },
        rollback: {
          mutationOptions: () => ({
            mutationKey: ['rollback'],
            mutationFn: mockRollbackMutation,
          }),
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

function setQueryOptions(
  queryClient: QueryClient,
  options: DeploymentOptions,
  releaseId = 'release-2',
  environmentId = 'environment-1',
) {
  queryClient.setQueryData(
    [
      'computeDeploymentOptions',
      {
        body: {
          releaseId,
          environmentId,
        },
      },
    ],
    {
      options,
    },
  )
}

describe('deploy drawer state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should open and close the deploy drawer with route identity', async () => {
    const state = await loadState()
    const { store } = createQueryAtomTestStore()

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
    const { store } = createQueryAtomTestStore()

    store.get(state.releaseDeploymentViewQueryAtom)
    expect(mockReleaseDeploymentViewQueryOptions).toHaveBeenLastCalledWith({
      enabled: false,
      input: skipToken,
    })

    store.set(state.deployFormAppInstanceIdAtom, 'app-instance-1')

    store.get(state.releaseDeploymentViewQueryAtom)
    expect(mockReleaseDeploymentViewQueryOptions).toHaveBeenLastCalledWith({
      enabled: true,
      input: { params: { appInstanceId: 'app-instance-1' } },
    })
  })

  it('should derive default environment and release selections from config', async () => {
    const state = await loadState()
    const { store } = createQueryAtomTestStore()
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
    const { queryClient, store } = createQueryAtomTestStore()
    const slot = credentialSlot()
    store.set(state.deployReadyFormConfigAtom, deployConfig())
    setQueryOptions(queryClient, {
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
    const { queryClient, store } = createQueryAtomTestStore()
    const slot = credentialSlot({
      lastCredentialId: 'credential-2',
    })
    store.set(state.deployReadyFormConfigAtom, deployConfig())
    setQueryOptions(queryClient, {
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
    const { queryClient, store } = createQueryAtomTestStore()
    store.set(state.deployReadyFormConfigAtom, deployConfig())
    setQueryOptions(queryClient, {
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
    const { queryClient, store } = createQueryAtomTestStore()
    store.set(state.deployReadyFormConfigAtom, deployConfig())
    setQueryOptions(queryClient, {
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

    await vi.waitFor(() => {
      expect(mockPromoteMutation).toHaveBeenCalledWith(
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
        expect.any(Object),
      )
    })
    expect(store.get(state.deployDrawerOpenAtom)).toBe(false)
  })
})
