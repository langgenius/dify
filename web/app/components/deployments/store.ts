import type { AccessMethod, AccessPermissionKind, ApiKey, AppInfo, CredentialBinding, Deployment, Environment, EnvVariable, Instance, InstanceAccess, Release } from './types'
import { create } from 'zustand'
import { MOCK_APP_ID_SLOTS, mockAccess, mockApiKeys, mockDeployments, mockEnvironments, mockInstances, mockReleases } from './mock-data'

const DEPLOY_MOCK_DURATION_MS = 2000
let releaseCounter = 44
let apiKeyCounter = 100
let instanceCounter = 100

function generateReleaseId() {
  const id = `R-0${releaseCounter}`
  releaseCounter += 1
  return id
}

function generateApiKeyId() {
  const id = `apikey-${apiKeyCounter}`
  apiKeyCounter += 1
  return id
}

function generateInstanceId() {
  const id = `instance-new-${instanceCounter}`
  instanceCounter += 1
  return id
}

function randomGateCommitId() {
  return Math.random().toString(16).slice(2, 10)
}

function nowStamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 16)
}

export type StartDeployParams = {
  instanceId: string
  environmentId: string
  releaseId?: string
  releaseNote?: string
  credentials: CredentialBinding[]
  envVariables: EnvVariable[]
}

type OpenDeployDrawerParams = {
  instanceId: string
  environmentId?: string
  releaseId?: string
}

type OpenRollbackParams = {
  deploymentId: string
  targetReleaseId: string
}

export type CreateInstanceParams = {
  appId: string
  name: string
  description?: string
}

type DeploymentsState = {
  environments: Environment[]
  instances: Instance[]
  deployments: Deployment[]
  releases: Release[]
  apiKeys: ApiKey[]
  access: InstanceAccess[]
  seededAppIds: string[] | null

  deployDrawer: {
    open: boolean
    instanceId?: string
    environmentId?: string
    releaseId?: string
  }
  rollbackModal: {
    open: boolean
    deploymentId?: string
    targetReleaseId?: string
  }
  createInstanceModal: { open: boolean }

  openDeployDrawer: (params: OpenDeployDrawerParams) => void
  closeDeployDrawer: () => void

  openRollbackModal: (params: OpenRollbackParams) => void
  closeRollbackModal: () => void

  openCreateInstanceModal: () => void
  closeCreateInstanceModal: () => void

  seedInstancesFromApps: (apps: AppInfo[]) => void

  createInstance: (params: CreateInstanceParams) => string
  updateInstance: (instanceId: string, patch: Partial<Pick<Instance, 'name' | 'description'>>) => void
  switchSourceApp: (instanceId: string, appId: string) => void
  deleteInstance: (instanceId: string) => void

  startDeploy: (params: StartDeployParams) => void
  retryDeploy: (deploymentId: string) => void
  rollbackDeployment: (deploymentId: string, targetReleaseId: string) => void
  undeployDeployment: (deploymentId: string) => void

  generateApiKey: (instanceId: string, environmentId: string) => void
  revokeApiKey: (apiKeyId: string) => void
  toggleAccessMethod: (instanceId: string, method: AccessMethod, enabled: boolean) => void
  setEnvAccessPermission: (instanceId: string, environmentId: string, kind: AccessPermissionKind) => void
  setEnvAccessMembers: (
    instanceId: string,
    environmentId: string,
    members: { memberIds: string[], groupIds: string[] },
  ) => void
}

function updateDeployment(deployments: Deployment[], deploymentId: string, patch: Partial<Deployment>): Deployment[] {
  return deployments.map(item => item.id === deploymentId ? { ...item, ...patch } : item)
}

export const useDeploymentsStore = create<DeploymentsState>((set, get) => ({
  environments: mockEnvironments,
  instances: mockInstances,
  deployments: mockDeployments,
  releases: mockReleases,
  apiKeys: mockApiKeys,
  access: mockAccess,
  seededAppIds: null,

  deployDrawer: { open: false },
  rollbackModal: { open: false },
  createInstanceModal: { open: false },

  openDeployDrawer: params => set({
    deployDrawer: {
      open: true,
      instanceId: params.instanceId,
      environmentId: params.environmentId,
      releaseId: params.releaseId,
    },
  }),
  closeDeployDrawer: () => set({ deployDrawer: { open: false } }),

  openRollbackModal: ({ deploymentId, targetReleaseId }) => set({
    rollbackModal: { open: true, deploymentId, targetReleaseId },
  }),
  closeRollbackModal: () => set({ rollbackModal: { open: false } }),

  openCreateInstanceModal: () => set({ createInstanceModal: { open: true } }),
  closeCreateInstanceModal: () => set({ createInstanceModal: { open: false } }),

  seedInstancesFromApps: (apps) => {
    if (apps.length === 0)
      return
    const realIds = apps.map(a => a.id)
    const previous = get().seededAppIds
    const unchanged
      = previous !== null
        && previous.length === realIds.length
        && previous.every((id, i) => id === realIds[i])
    if (unchanged)
      return

    const slotMap: Record<string, string> = {}
    MOCK_APP_ID_SLOTS.forEach((mockId, idx) => {
      const real = apps[idx % apps.length]!
      slotMap[mockId] = real.id
    })

    set(state => ({
      instances: state.instances.map((i) => {
        const bindingProfileId = i.bindingProfileId ?? i.appId
        return {
          ...i,
          appId: slotMap[bindingProfileId] ?? i.appId,
          bindingProfileId,
        }
      }),
      releases: state.releases.map(r => ({
        ...r,
        appId: slotMap[r.appId] ?? r.appId,
      })),
      seededAppIds: realIds,
    }))
  },

  createInstance: ({ appId, name, description }) => {
    const id = generateInstanceId()
    const instance: Instance = {
      id,
      appId,
      name,
      description,
      createdAt: nowStamp(),
    }
    set(state => ({
      instances: [...state.instances, instance],
      access: [
        ...state.access,
        {
          instanceId: id,
          enabled: { api: true, runAccess: true },
          envPermissions: [],
        },
      ],
      createInstanceModal: { open: false },
    }))
    return id
  },

  updateInstance: (instanceId, patch) => {
    set(state => ({
      instances: state.instances.map(item => item.id === instanceId ? { ...item, ...patch } : item),
    }))
  },

  switchSourceApp: (instanceId, appId) => {
    set(state => ({
      instances: state.instances.map(item => item.id === instanceId ? { ...item, appId, bindingProfileId: appId } : item),
    }))
  },

  deleteInstance: (instanceId) => {
    set(state => ({
      instances: state.instances.filter(item => item.id !== instanceId),
      deployments: state.deployments.filter(d => d.instanceId !== instanceId),
      apiKeys: state.apiKeys.filter(k => k.instanceId !== instanceId),
      access: state.access.filter(a => a.instanceId !== instanceId),
    }))
  },

  startDeploy: ({ instanceId, environmentId, releaseId, releaseNote, credentials, envVariables }) => {
    const instance = get().instances.find(i => i.id === instanceId)
    if (!instance)
      return

    let targetReleaseId = releaseId
    let newRelease: Release | undefined
    if (!targetReleaseId) {
      const newReleaseId = generateReleaseId()
      const trimmedNote = releaseNote?.trim()
      newRelease = {
        id: newReleaseId,
        appId: instance.appId,
        gateCommitId: randomGateCommitId(),
        operator: 'you',
        createdAt: nowStamp(),
        description: trimmedNote || 'draft deploy',
        yaml: `# Release: ${newReleaseId}\napp:\n  name: ${instance.appId}\n  mode: advanced-chat\n`,
      }
      targetReleaseId = newReleaseId
    }

    const existing = get().deployments.find(d => d.instanceId === instanceId && d.environmentId === environmentId)
    let nextDeployments: Deployment[]
    let targetDeploymentId: string
    if (existing) {
      targetDeploymentId = existing.id
      nextDeployments = updateDeployment(get().deployments, existing.id, {
        status: 'deploying',
        targetReleaseId,
        failedReleaseId: undefined,
        credentials,
        envVariables,
        errorMessage: undefined,
      })
    }
    else {
      targetDeploymentId = `dep-${instanceId}-${environmentId}-${Date.now()}`
      const newDeployment: Deployment = {
        id: targetDeploymentId,
        instanceId,
        environmentId,
        activeReleaseId: targetReleaseId,
        targetReleaseId,
        status: 'deploying',
        runtimeNote: 'Loading...',
        credentials,
        envVariables,
        createdAt: nowStamp(),
      }
      nextDeployments = [...get().deployments, newDeployment]
    }

    set(state => ({
      deployments: nextDeployments,
      releases: newRelease ? [newRelease, ...state.releases] : state.releases,
      deployDrawer: { open: false },
    }))

    setTimeout(() => {
      set(state => ({
        deployments: updateDeployment(state.deployments, targetDeploymentId, {
          activeReleaseId: targetReleaseId,
          targetReleaseId: undefined,
          failedReleaseId: undefined,
          status: 'ready',
          runtimeNote: 'Loaded in memory',
        }),
      }))
    }, DEPLOY_MOCK_DURATION_MS)
  },

  retryDeploy: (deploymentId) => {
    const deployment = get().deployments.find(d => d.id === deploymentId)
    if (!deployment)
      return
    const targetReleaseId = deployment.failedReleaseId ?? deployment.targetReleaseId ?? deployment.activeReleaseId
    set(state => ({
      deployments: updateDeployment(state.deployments, deploymentId, {
        status: 'deploying',
        targetReleaseId,
        failedReleaseId: undefined,
        errorMessage: undefined,
      }),
    }))
    setTimeout(() => {
      set(state => ({
        deployments: updateDeployment(state.deployments, deploymentId, {
          activeReleaseId: targetReleaseId,
          targetReleaseId: undefined,
          status: 'ready',
          runtimeNote: 'Loaded in memory',
        }),
      }))
    }, DEPLOY_MOCK_DURATION_MS)
  },

  rollbackDeployment: (deploymentId, targetReleaseId) => {
    set(state => ({
      deployments: updateDeployment(state.deployments, deploymentId, {
        status: 'deploying',
        targetReleaseId,
        failedReleaseId: undefined,
        errorMessage: undefined,
      }),
      rollbackModal: { open: false },
    }))
    setTimeout(() => {
      set(state => ({
        deployments: updateDeployment(state.deployments, deploymentId, {
          activeReleaseId: targetReleaseId,
          targetReleaseId: undefined,
          status: 'ready',
          runtimeNote: 'Loaded in memory',
        }),
      }))
    }, DEPLOY_MOCK_DURATION_MS)
  },

  undeployDeployment: (deploymentId) => {
    set(state => ({
      deployments: state.deployments.filter(d => d.id !== deploymentId),
    }))
  },

  generateApiKey: (instanceId, environmentId) => {
    const existingCount = get().apiKeys.filter(k => k.instanceId === instanceId && k.environmentId === environmentId).length
    const env = get().environments.find(e => e.id === environmentId)
    const labelPrefix = env?.name ?? 'env'
    const label = `${labelPrefix}-key-${String(existingCount + 1).padStart(3, '0')}`
    const suffix = Math.random().toString(16).slice(2, 12)
    const newKey: ApiKey = {
      id: generateApiKeyId(),
      instanceId,
      environmentId,
      label,
      value: `app-${instanceId.slice(-4)}-${suffix}`,
      createdAt: nowStamp(),
    }
    set(state => ({ apiKeys: [newKey, ...state.apiKeys] }))
  },

  revokeApiKey: (apiKeyId) => {
    set(state => ({
      apiKeys: state.apiKeys.filter(k => k.id !== apiKeyId),
    }))
  },

  toggleAccessMethod: (instanceId, method, enabled) => {
    set(state => ({
      access: state.access.map((a) => {
        if (a.instanceId !== instanceId)
          return a
        return { ...a, enabled: { ...a.enabled, [method]: enabled } }
      }),
    }))
  },

  setEnvAccessPermission: (instanceId, environmentId, kind) => {
    set(state => ({
      access: state.access.map((a) => {
        if (a.instanceId !== instanceId)
          return a
        const existingIdx = a.envPermissions.findIndex(p => p.environmentId === environmentId)
        const existing = existingIdx >= 0 ? a.envPermissions[existingIdx] : undefined
        const nextEntry = kind === 'specific'
          ? {
              environmentId,
              kind,
              memberIds: existing?.memberIds ?? [],
              groupIds: existing?.groupIds ?? [],
            }
          : { environmentId, kind }
        const envPermissions = existingIdx >= 0
          ? a.envPermissions.map((p, i) => (i === existingIdx ? nextEntry : p))
          : [...a.envPermissions, nextEntry]
        return { ...a, envPermissions }
      }),
    }))
  },

  setEnvAccessMembers: (instanceId, environmentId, { memberIds, groupIds }) => {
    set(state => ({
      access: state.access.map((a) => {
        if (a.instanceId !== instanceId)
          return a
        const existingIdx = a.envPermissions.findIndex(p => p.environmentId === environmentId)
        const nextEntry = {
          environmentId,
          kind: 'specific' as AccessPermissionKind,
          memberIds,
          groupIds,
        }
        const envPermissions = existingIdx >= 0
          ? a.envPermissions.map((p, i) => (i === existingIdx ? nextEntry : p))
          : [...a.envPermissions, nextEntry]
        return { ...a, envPermissions }
      }),
    }))
  },
}))
