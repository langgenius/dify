export type MockDeploymentStatus = 'deploying' | 'failed' | 'running'

export type AccessPoint = 'mcp' | 'serviceApi' | 'trigger' | 'webApp'

export type MockActivity = {
  actor: string
  occurredAt: number
  result: 'failed' | 'started' | 'succeeded'
  target: string
}

export type MockVersion = {
  behind?: number
  description?: string
  latest?: boolean
  name: string
  publishedAt: number
  publishedBy: string
  tags?: string[]
}

export type MockDeploymentCredential = {
  category: 'Model' | 'Plugin'
  id: 'github' | 'moonshot' | 'slack'
  name: string
  options: Array<{
    label: string
    value: string
  }>
  selectedValue: string
}

export type MockEnvironmentVariableValueSource = 'configured' | 'custom' | 'lastDeployed'

export type MockEnvironmentVariable = {
  configuredValue: string
  customValue: string
  description: string
  key: string
  lastDeployedValue: string
  source: MockEnvironmentVariableValueSource
  valueType: 'number' | 'secret' | 'string'
}

export type MockRowAction =
  | { disabled?: boolean; kind: 'changeVersion' }
  | { kind: 'deployLatest' }
  | { kind: 'redeploy' }
  | { kind: 'retry'; version: string }

export type MockEnvironmentDeployment = {
  accessPoints: AccessPoint[]
  action: MockRowAction
  activity: MockActivity
  id: string
  name: string
  status: MockDeploymentStatus
  version?: MockVersion
}

export const ACCESS_POINT_ORDER: readonly AccessPoint[] = ['webApp', 'serviceApi', 'mcp', 'trigger']

const MOCK_VERSION_DESCRIPTION =
  'Fixed several critical bugs affecting data synchronization and optimized page loading speed. Enhanced system stability and user experience through backend improvements.'
const MOCK_VERSION_PUBLISHED_AT = Date.now() - 17 * 24 * 60 * 60 * 1000

function createMockVersion(
  name: string,
  overrides: Omit<Partial<MockVersion>, 'name'> = {},
): MockVersion {
  return {
    name,
    publishedAt: MOCK_VERSION_PUBLISHED_AT,
    publishedBy: 'Minco',
    ...overrides,
  }
}

export const BUILT_IN_ENVIRONMENT: {
  accessPoints: AccessPoint[]
  actor: string
  updatedAt: string
  version: MockVersion
} = {
  accessPoints: ['webApp', 'serviceApi'],
  actor: 'Evan',
  updatedAt: '07-01 09:00',
  version: createMockVersion('Sprint-42', {
    latest: true,
  }),
}

export const MOCK_ENVIRONMENT_CAPACITY = 12

const MOCK_ACTIVITY_AT = Date.UTC(2026, 6, 25, 1)

export const MOCK_ENVIRONMENT_DEPLOYMENTS: MockEnvironmentDeployment[] = [
  {
    accessPoints: ['webApp', 'serviceApi', 'mcp'],
    action: { disabled: true, kind: 'changeVersion' },
    activity: { actor: 'Evan', occurredAt: MOCK_ACTIVITY_AT, result: 'started', target: '#1' },
    id: 'staging',
    name: 'Staging',
    status: 'deploying',
  },
  {
    accessPoints: ['webApp', 'serviceApi', 'mcp'],
    action: { kind: 'changeVersion' },
    activity: {
      actor: 'Evan',
      occurredAt: MOCK_ACTIVITY_AT,
      result: 'succeeded',
      target: 'Sprint-42',
    },
    id: 'canary',
    name: 'Canary',
    status: 'running',
    version: createMockVersion('Sprint-42', {
      description: MOCK_VERSION_DESCRIPTION,
      latest: true,
    }),
  },
  {
    accessPoints: ['webApp', 'serviceApi'],
    action: { kind: 'deployLatest' },
    activity: { actor: 'Evan', occurredAt: MOCK_ACTIVITY_AT, result: 'succeeded', target: '#11' },
    id: 'pre-release',
    name: 'Pre-release',
    status: 'running',
    version: createMockVersion('Version-02', { behind: 1 }),
  },
  {
    accessPoints: ['webApp', 'serviceApi'],
    action: { kind: 'deployLatest' },
    activity: {
      actor: 'Rhonda',
      occurredAt: MOCK_ACTIVITY_AT,
      result: 'succeeded',
      target: '#11',
    },
    id: 'prod',
    name: 'Prod',
    status: 'running',
    version: createMockVersion('v0.9-hotfix', { behind: 1 }),
  },
  {
    accessPoints: ['trigger'],
    action: { kind: 'deployLatest' },
    activity: { actor: 'Rhonda', occurredAt: MOCK_ACTIVITY_AT, result: 'failed', target: '#10' },
    id: 'eu-prod',
    name: 'EU-Prod',
    status: 'running',
    version: createMockVersion('v0.6-beta', { behind: 2 }),
  },
  {
    accessPoints: ['trigger'],
    action: { kind: 'redeploy' },
    activity: {
      actor: 'Rhonda',
      occurredAt: MOCK_ACTIVITY_AT,
      result: 'succeeded',
      target: '#11',
    },
    id: 'qa',
    name: 'QA',
    status: 'running',
    version: createMockVersion('v0.3-beta', { behind: 1 }),
  },
  {
    accessPoints: ['trigger'],
    action: { kind: 'redeploy' },
    activity: {
      actor: 'Rhonda',
      occurredAt: MOCK_ACTIVITY_AT,
      result: 'succeeded',
      target: '#11',
    },
    id: 'sandbox',
    name: 'Sandbox',
    status: 'running',
    version: createMockVersion('v0.3-beta', { behind: 5 }),
  },
  {
    accessPoints: ['trigger'],
    action: { kind: 'retry', version: 'Sprint-42' },
    activity: {
      actor: 'Rhonda',
      occurredAt: MOCK_ACTIVITY_AT,
      result: 'failed',
      target: 'Sprint-42',
    },
    id: 'preview',
    name: 'Preview',
    status: 'failed',
  },
]

export const MOCK_UNDEPLOYED_ENVIRONMENTS = ['Testing', 'Dev', 'Demo', 'US-Prod']

export const MOCK_PUBLISHED_VERSIONS: MockVersion[] = [
  createMockVersion('#6', {
    latest: true,
    publishedBy: 'Evan',
    tags: ['Pre-release', 'v0.9-hotfix'],
  }),
  createMockVersion('#5', {
    description: MOCK_VERSION_DESCRIPTION,
    publishedBy: 'Evan',
    tags: ['Pre-release', 'v0.9-hotfix'],
  }),
  createMockVersion('Sprint-42', { publishedBy: 'Evan' }),
  createMockVersion('Sprint-35', { publishedBy: 'Evan' }),
  createMockVersion('Sprint-28', { publishedBy: 'Evan' }),
  createMockVersion('Sprint-16', { publishedBy: 'Evan' }),
]

export const MOCK_DEPLOYMENT_CREDENTIALS: MockDeploymentCredential[] = [
  {
    category: 'Model',
    id: 'moonshot',
    name: 'Moonshot',
    options: [
      { label: 'Enterprise key', value: 'enterprise' },
      { label: 'Development key', value: 'development' },
    ],
    selectedValue: 'enterprise',
  },
  {
    category: 'Plugin',
    id: 'github',
    name: 'GitHub',
    options: [
      { label: 'GitHub OAuth Key', value: 'oauth' },
      { label: 'GitHub personal token', value: 'personal-token' },
    ],
    selectedValue: 'oauth',
  },
  {
    category: 'Plugin',
    id: 'slack',
    name: 'Slack',
    options: [
      { label: 'Slack workspace OAuth', value: 'workspace-oauth' },
      { label: 'Slack bot token', value: 'bot-token' },
    ],
    selectedValue: 'workspace-oauth',
  },
]

export const MOCK_ENVIRONMENT_VARIABLES: MockEnvironmentVariable[] = [
  {
    configuredValue: '2',
    customValue: '2',
    description: 'Server port',
    key: 'PORT',
    lastDeployedValue: '1',
    source: 'configured',
    valueType: 'number',
  },
  {
    configuredValue: 'sk-********abc',
    customValue: '',
    description: 'Invoking large language models to answer questions or process natural language',
    key: 'API_KEY',
    lastDeployedValue: 'sk-********xyz',
    source: 'configured',
    valueType: 'secret',
  },
  {
    configuredValue: 'environment variable',
    customValue: '',
    description: '',
    key: 'name',
    lastDeployedValue: 'environment variable 01',
    source: 'lastDeployed',
    valueType: 'string',
  },
]
