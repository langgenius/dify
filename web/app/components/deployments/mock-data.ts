import type { ApiKey, Credential, Deployment, Environment, Instance, InstanceAccess, Member, MemberGroup, Release } from './types'

export const mockEnvironments: Environment[] = [
  {
    id: 'env-default',
    name: 'default',
    namespace: 'default',
    description: 'Default shared environment, provisioned by Helm',
    mode: 'shared',
    backend: 'k8s',
    health: 'ready',
    createdAt: '2026-03-02 10:11',
  },
  {
    id: 'env-prod-isolated',
    name: 'prod-isolated',
    namespace: 'payments',
    description: 'Isolated production environment for the Payments team',
    mode: 'isolated',
    backend: 'k8s',
    health: 'ready',
    createdAt: '2026-03-14 19:22',
  },
  {
    id: 'env-qa-host',
    name: 'qa-host',
    namespace: '—',
    description: 'Staging host pool used for smoke testing',
    mode: 'shared',
    backend: 'host',
    health: 'degraded',
    createdAt: '2026-02-08 16:40',
  },
]

export const MOCK_APP_ID_SLOTS = [
  'app-customer-support',
  'app-payments-workflow',
  'app-marketing-copy',
  'app-onboarding-draft',
] as const

export const mockCredentials: Credential[] = [
  {
    id: 'cred-openai-prod',
    name: 'openai-prod',
    provider: 'OpenAI',
    kind: 'model',
    scope: 'Workspace scoped',
    validated: true,
  },
  {
    id: 'cred-openai-test',
    name: 'openai-test',
    provider: 'OpenAI',
    kind: 'model',
    scope: 'Workspace scoped',
    validated: false,
  },
  {
    id: 'cred-deepseek-prod',
    name: 'deepseek-prod',
    provider: 'DeepSeek',
    kind: 'model',
    scope: 'Workspace scoped',
    validated: true,
  },
  {
    id: 'cred-anthropic-prod',
    name: 'anthropic-prod',
    provider: 'Anthropic',
    kind: 'model',
    scope: 'Workspace scoped',
    validated: true,
  },
  {
    id: 'cred-gmail-key001',
    name: 'gmail-key001',
    provider: 'Gmail',
    kind: 'plugin',
    scope: 'Workspace scoped',
    validated: true,
  },
  {
    id: 'cred-notion-key001',
    name: 'notion-key001',
    provider: 'Notion',
    kind: 'plugin',
    scope: 'Workspace scoped',
    validated: true,
  },
]

const sampleYaml = (appName: string, releaseId: string) => `# Release: ${releaseId}
app:
  name: ${appName}
  mode: advanced-chat
  model:
    provider: openai
    name: gpt-4o
    parameters:
      temperature: 0.2
      top_p: 0.95
  prompt: |
    You are a helpful assistant for ${appName}.
    Follow company guidelines strictly.
  tools:
    - code-interpreter
    - knowledge-retrieval
runner:
  replicas: 3
  maxTokens: 16384
  timeoutSeconds: 120
observability:
  logLevel: info
  tracing: true
`

export const mockReleases: Release[] = [
  {
    id: 'R-043',
    appId: 'app-payments-workflow',
    gateCommitId: 'a3716d90',
    operator: 'byron',
    createdAt: '2026-04-15 19:08',
    description: 'current draft deploy',
    yaml: sampleYaml('Payments Workflow', 'R-043'),
  },
  {
    id: 'R-042',
    appId: 'app-customer-support',
    gateCommitId: '9f23a1d2',
    operator: 'byron',
    createdAt: '2026-04-15 18:32',
    description: 'stable release',
    yaml: sampleYaml('Customer Support Bot', 'R-042'),
  },
  {
    id: 'R-041',
    appId: 'app-marketing-copy',
    gateCommitId: '7db24e51',
    operator: 'alice',
    createdAt: '2026-04-13 15:10',
    description: 'deploy failed on qa',
    yaml: sampleYaml('Marketing Copy Generator', 'R-041'),
  },
  {
    id: 'R-040',
    appId: 'app-marketing-copy',
    gateCommitId: '58c10aee',
    operator: 'alice',
    createdAt: '2026-04-12 09:24',
    description: 'last stable qa release',
    yaml: sampleYaml('Marketing Copy Generator', 'R-040'),
  },
  {
    id: 'R-037',
    appId: 'app-customer-support',
    gateCommitId: '810fd671',
    operator: 'alice',
    createdAt: '2026-04-11 10:02',
    description: 'historic',
    yaml: sampleYaml('Customer Support Bot', 'R-037'),
  },
  {
    id: 'R-031',
    appId: 'app-payments-workflow',
    gateCommitId: '4ac82db1',
    operator: 'alice',
    createdAt: '2026-04-07 14:55',
    description: 'initial deploy',
    yaml: sampleYaml('Payments Workflow', 'R-031'),
  },
]

export const mockInstances: Instance[] = [
  {
    id: 'instance-cs',
    appId: 'app-customer-support',
    name: 'Customer Support',
    description: 'Frontline CS assistant',
    createdAt: '2026-02-10 12:23',
  },
  {
    id: 'instance-payments',
    appId: 'app-payments-workflow',
    name: 'Payments Orchestrator',
    description: 'Payment intent processing',
    createdAt: '2026-02-18 09:41',
  },
  {
    id: 'instance-marketing',
    appId: 'app-marketing-copy',
    name: 'Marketing Copy',
    description: 'Ad copy generator',
    createdAt: '2026-03-04 14:02',
  },
  {
    id: 'instance-onboarding-draft',
    appId: 'app-onboarding-draft',
    name: 'Onboarding Draft',
    description: 'Draft assistant waiting for its first environment deployment',
    createdAt: '2026-04-18 10:30',
  },
]

export const mockDeployments: Deployment[] = [
  {
    id: 'dep-cs-default',
    instanceId: 'instance-cs',
    environmentId: 'env-default',
    activeReleaseId: 'R-042',
    status: 'ready',
    replicas: 1,
    runtimeNote: 'Loaded in memory',
    credentials: [
      { provider: 'OpenAI', kind: 'model', credentialId: 'cred-openai-prod' },
      { provider: 'Gmail', kind: 'plugin', credentialId: 'cred-gmail-key001' },
    ],
    envVariables: [
      { key: 'dbkey', value: 'xxxxx', type: 'secret' },
      { key: 'keyno', value: '14', type: 'string' },
    ],
    createdAt: '2026-02-10 12:25',
  },
  {
    id: 'dep-cs-prod',
    instanceId: 'instance-cs',
    environmentId: 'env-prod-isolated',
    activeReleaseId: 'R-037',
    status: 'ready',
    replicas: 3,
    runtimeNote: 'Loaded in memory',
    credentials: [
      { provider: 'OpenAI', kind: 'model', credentialId: 'cred-openai-prod' },
    ],
    envVariables: [],
    createdAt: '2026-03-02 15:10',
  },
  {
    id: 'dep-payments-default',
    instanceId: 'instance-payments',
    environmentId: 'env-default',
    activeReleaseId: 'R-031',
    status: 'ready',
    replicas: 1,
    runtimeNote: 'Loaded in memory',
    credentials: [
      { provider: 'Anthropic', kind: 'model', credentialId: 'cred-anthropic-prod' },
    ],
    envVariables: [],
    createdAt: '2026-04-07 15:00',
  },
  {
    id: 'dep-payments-prod',
    instanceId: 'instance-payments',
    environmentId: 'env-prod-isolated',
    activeReleaseId: 'R-031',
    targetReleaseId: 'R-043',
    status: 'deploying',
    replicas: 3,
    runtimeNote: 'Replicas 3 / Runtime Shell retained',
    credentials: [
      { provider: 'OpenAI', kind: 'model', credentialId: 'cred-openai-prod' },
      { provider: 'DeepSeek', kind: 'model', credentialId: 'cred-deepseek-prod' },
      { provider: 'Gmail', kind: 'plugin', credentialId: 'cred-gmail-key001' },
      { provider: 'Notion', kind: 'plugin', credentialId: 'cred-notion-key001' },
    ],
    envVariables: [
      { key: 'kn', value: 'this-is-kn-value', type: 'string' },
      { key: 'dbkey', value: 'xxxxx', type: 'secret' },
    ],
    createdAt: '2026-04-15 19:08',
  },
  {
    id: 'dep-marketing-qa',
    instanceId: 'instance-marketing',
    environmentId: 'env-qa-host',
    activeReleaseId: 'R-040',
    failedReleaseId: 'R-041',
    status: 'deploy_failed',
    errorMessage: 'Credential validate failed for openai-test',
    runtimeNote: 'AppRunner Daemon Mode',
    credentials: [
      { provider: 'OpenAI', kind: 'model', credentialId: 'cred-openai-test' },
    ],
    envVariables: [],
    createdAt: '2026-04-13 15:10',
  },
]

export const mockApiKeys: ApiKey[] = [
  {
    id: 'apikey-cs-default',
    instanceId: 'instance-cs',
    environmentId: 'env-default',
    label: 'default-key-001',
    value: 'app-cs-default-b1c72a8f9d',
    createdAt: '2026-02-10 12:25',
  },
  {
    id: 'apikey-cs-prod',
    instanceId: 'instance-cs',
    environmentId: 'env-prod-isolated',
    label: 'prod-key-001',
    value: 'app-cs-prod-8a31f22d7c',
    createdAt: '2026-03-02 15:11',
  },
  {
    id: 'apikey-payments-default',
    instanceId: 'instance-payments',
    environmentId: 'env-default',
    label: 'default-key-001',
    value: 'app-pay-default-4c91a7e03b',
    createdAt: '2026-04-07 15:01',
  },
  {
    id: 'apikey-payments-prod',
    instanceId: 'instance-payments',
    environmentId: 'env-prod-isolated',
    label: 'prod-key-001',
    value: 'app-pay-prod-de1f5b8a62',
    createdAt: '2026-04-15 19:10',
  },
  {
    id: 'apikey-marketing-qa',
    instanceId: 'instance-marketing',
    environmentId: 'env-qa-host',
    label: 'qa-key-001',
    value: 'app-mk-qa-91ab2c3de4',
    createdAt: '2026-04-13 15:12',
  },
]

export const mockMembers: Member[] = [
  { id: 'mem-ava', name: 'Ava Chen', email: 'ava.chen@dify.ai' },
  { id: 'mem-lucas', name: 'Lucas Martin', email: 'lucas.martin@dify.ai' },
  { id: 'mem-rin', name: 'Rin Tanaka', email: 'rin.tanaka@dify.ai' },
  { id: 'mem-owen', name: 'Owen Walker', email: 'owen.walker@dify.ai' },
  { id: 'mem-noa', name: 'Noa Baker', email: 'noa.baker@dify.ai' },
  { id: 'mem-harper', name: 'Harper Young', email: 'harper.young@dify.ai' },
  { id: 'mem-ellis', name: 'Ellis Park', email: 'ellis.park@dify.ai' },
  { id: 'mem-zane', name: 'Zane Okafor', email: 'zane.okafor@dify.ai' },
  { id: 'mem-iris', name: 'Iris Novak', email: 'iris.novak@dify.ai' },
  { id: 'mem-mia', name: 'Mia Delgado', email: 'mia.delgado@dify.ai' },
  { id: 'mem-kai', name: 'Kai Andersson', email: 'kai.andersson@dify.ai' },
  { id: 'mem-ren', name: 'Ren Fujimoto', email: 'ren.fujimoto@dify.ai' },
]

export const mockMemberGroups: MemberGroup[] = [
  { id: 'group-engineering', name: 'Engineering', memberCount: 85, description: 'Platform, backend and infra engineers' },
  { id: 'group-support', name: 'Customer Success', memberCount: 118, description: 'Tier 1 and Tier 2 customer support' },
  { id: 'group-design', name: 'Design', memberCount: 14, description: 'Product and brand designers' },
  { id: 'group-ops', name: 'Operations', memberCount: 9, description: 'Admins and workspace operators' },
]

export const mockAccess: InstanceAccess[] = [
  {
    instanceId: 'instance-cs',
    enabled: { api: true, runAccess: true },
    webappUrl: 'https://my.webapp.com/afc28cef',
    mcpUrl: 'https://mcp.dify.internal/instance-cs',
    envPermissions: [
      { environmentId: 'env-prod-isolated', kind: 'organization' },
      {
        environmentId: 'env-default',
        kind: 'specific',
        memberIds: ['mem-ava', 'mem-lucas', 'mem-rin'],
        groupIds: ['group-engineering', 'group-support'],
      },
      {
        environmentId: 'env-testing',
        kind: 'specific',
        memberIds: ['mem-owen'],
        groupIds: [],
      },
    ],
  },
  {
    instanceId: 'instance-payments',
    enabled: { api: true, runAccess: false },
    webappUrl: 'https://my.webapp.com/payments',
    mcpUrl: 'https://mcp.dify.internal/instance-payments',
    envPermissions: [
      {
        environmentId: 'env-prod-isolated',
        kind: 'specific',
        memberIds: ['mem-noa', 'mem-harper', 'mem-ellis'],
        groupIds: ['group-ops'],
      },
      { environmentId: 'env-default', kind: 'organization' },
    ],
  },
  {
    instanceId: 'instance-marketing',
    enabled: { api: true, runAccess: true },
    webappUrl: 'https://my.webapp.com/marketing',
    envPermissions: [
      { environmentId: 'env-default', kind: 'anyone' },
    ],
  },
  {
    instanceId: 'instance-onboarding-draft',
    enabled: { api: false, runAccess: false },
    envPermissions: [],
  },
]
