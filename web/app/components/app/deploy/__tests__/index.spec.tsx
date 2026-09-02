import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import type {
  AppEnvironment,
  EnvironmentDeployment,
  EnvironmentDeploymentOperation,
  GetWorkflowDeploymentOptionsResponse,
  WorkflowVersion,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import {
  DeploymentOperationStatus,
  DeploymentOperationType,
  DeploymentStatus,
  EnvironmentStatus,
  EnvVarValueSource,
  EnvVarValueType,
  OperatorType,
  PluginCategory,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import { toast } from '@langgenius/dify-ui/toast'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/client'
import {
  appWorkflowQueryOptions,
  appWorkflowVersionsInfiniteQueryOptions,
} from '@/service/workflow-queries'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { AppACLPermission } from '@/utils/permission'
import AppDeploy from '..'
import { EnvironmentTable } from '../environment-table'
import { AppDeployStateBoundary, getEnvironmentDeploymentActions } from '../state'

const APP_ID = 'app-1'
const ACTIVITY_AT = 1_784_941_200
const VERSION_DESCRIPTION =
  'Fixed several critical bugs affecting data synchronization and optimized page loading speed. Enhanced system stability and user experience through backend improvements.'
const OPERATOR = {
  display_name: 'Evan',
  id: 'user-2',
  type: OperatorType.OPERATOR_TYPE_ACCOUNT,
}

function workflowVersion(name: string, id = name.toLowerCase()): WorkflowVersion {
  return {
    id,
    marked_comment: name === 'Sprint-42' ? VERSION_DESCRIPTION : '',
    marked_name: name,
    version: `2026-07-30.${id}`,
  }
}

const VERSIONS = {
  sprint42: workflowVersion('Sprint-42', 'sprint-42'),
  version02: workflowVersion('Version-02', 'version-02'),
  hotfix: workflowVersion('v0.9-hotfix', 'hotfix'),
  beta: workflowVersion('v0.6-beta', 'beta'),
  qa: workflowVersion('v0.3-beta', 'qa-version'),
}

function publishedWorkflowVersion({
  comment = '',
  id,
  name,
  publishedBy = 'Alice',
}: {
  comment?: string
  id: string
  name: string
  publishedBy?: string
}): WorkflowResponse {
  return {
    conversation_variables: [],
    created_at: 1_710_000_100,
    created_by: {
      email: `${publishedBy.toLowerCase()}@example.com`,
      id: `user-${publishedBy.toLowerCase()}`,
      name: publishedBy,
    },
    environment_variables: [],
    features: {},
    graph: {},
    hash: `hash-${id}`,
    id,
    marked_comment: comment,
    marked_name: name,
    rag_pipeline_variables: [],
    tool_published: false,
    updated_at: 1_710_000_100,
    version: `2026-07-30.${id}`,
  }
}

const PUBLISHED_WORKFLOW_VERSIONS = [
  publishedWorkflowVersion({
    comment: 'Latest production workflow',
    id: 'workflow-version-7',
    name: 'Release 7',
  }),
  publishedWorkflowVersion({
    comment: 'Previous production workflow',
    id: 'workflow-version-6',
    name: 'Release 6',
    publishedBy: 'Carol',
  }),
  publishedWorkflowVersion({
    id: 'sprint-42',
    name: 'Sprint-42',
    publishedBy: 'Evan',
  }),
]

const SUCCESSFUL_WORKFLOW_DEPLOYMENT_PRECHECK = {
  unsupported_nodes: [],
}

const WORKFLOW_DEPLOYMENT_OPTIONS: GetWorkflowDeploymentOptionsResponse = {
  credential_slots: [
    {
      candidates: [
        {
          category: PluginCategory.PLUGIN_CATEGORY_MODEL,
          credential_id: 'enterprise',
          display_name: 'Enterprise deployment key',
          from_enterprise: true,
          provider_id: 'moonshot',
        },
        {
          category: PluginCategory.PLUGIN_CATEGORY_MODEL,
          credential_id: 'development',
          display_name: 'Development key',
          from_enterprise: false,
          provider_id: 'moonshot',
        },
      ],
      category: PluginCategory.PLUGIN_CATEGORY_MODEL,
      last_deployed_credential_id: 'enterprise',
      provider_id: 'moonshot',
    },
    {
      candidates: [
        {
          category: PluginCategory.PLUGIN_CATEGORY_TOOL,
          credential_id: 'github-oauth',
          display_name: 'GitHub OAuth Key',
          from_enterprise: false,
          provider_id: 'github',
        },
      ],
      category: PluginCategory.PLUGIN_CATEGORY_TOOL,
      last_deployed_credential_id: 'github-oauth',
      provider_id: 'github',
    },
  ],
  environment_variable_slots: [
    {
      configured_value: '2',
      description: 'Server port',
      has_configured_value: true,
      has_last_deployed_value: true,
      key: 'PORT',
      value_type: EnvVarValueType.ENV_VAR_VALUE_TYPE_NUMBER,
    },
    {
      configured_value: 'sk-123************bc',
      description: 'API credential',
      has_configured_value: true,
      has_last_deployed_value: true,
      key: 'API_KEY',
      value_type: EnvVarValueType.ENV_VAR_VALUE_TYPE_SECRET,
    },
    {
      description: '',
      has_configured_value: false,
      has_last_deployed_value: true,
      key: 'name',
      last_deployed_value: 'environment variable 01',
      value_type: EnvVarValueType.ENV_VAR_VALUE_TYPE_STRING,
    },
  ],
}

function deploymentOperation({
  id,
  status = DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED,
  targetVersion,
  type = DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_DEPLOY,
}: {
  id: string
  status?: EnvironmentDeploymentOperation['status']
  targetVersion?: WorkflowVersion
  type?: EnvironmentDeploymentOperation['type']
}): EnvironmentDeploymentOperation {
  return {
    activity_at: ACTIVITY_AT,
    id,
    operator: OPERATOR,
    status,
    target_version: targetVersion,
    type,
  }
}

function environmentDeployment({
  access = { enable_api: true, enable_site: true },
  currentVersion,
  id,
  latestOperation,
  name,
  status,
  versionsBehind,
}: {
  access?: EnvironmentDeployment['access']
  currentVersion?: WorkflowVersion
  id: string
  latestOperation?: EnvironmentDeploymentOperation
  name: string
  status: NonNullable<EnvironmentDeployment['deployment']>['status']
  versionsBehind?: number
}): EnvironmentDeployment {
  return {
    access,
    deployment: {
      current_version: currentVersion,
      deployed_at: currentVersion ? ACTIVITY_AT : undefined,
      deployed_by: currentVersion ? OPERATOR : undefined,
      latest_operation: latestOperation,
      status,
      versions_behind: versionsBehind,
    },
    environment: {
      description: '',
      display_name: name,
      id,
      status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
    },
  }
}

const APP_ENVIRONMENT_DEPLOYMENTS: EnvironmentDeployment[] = [
  environmentDeployment({
    id: 'staging',
    latestOperation: deploymentOperation({
      id: '1',
      status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS,
      targetVersion: VERSIONS.sprint42,
    }),
    name: 'Staging',
    status: DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING,
  }),
  environmentDeployment({
    currentVersion: VERSIONS.sprint42,
    id: 'canary',
    latestOperation: deploymentOperation({
      id: '2',
      targetVersion: VERSIONS.sprint42,
    }),
    name: 'Canary',
    status: DeploymentStatus.DEPLOYMENT_STATUS_RUNNING,
    versionsBehind: 0,
  }),
  environmentDeployment({
    currentVersion: VERSIONS.version02,
    id: 'pre-release',
    latestOperation: deploymentOperation({
      id: '11',
      targetVersion: VERSIONS.version02,
    }),
    name: 'Pre-release',
    status: DeploymentStatus.DEPLOYMENT_STATUS_RUNNING,
    versionsBehind: 1,
  }),
  environmentDeployment({
    currentVersion: VERSIONS.hotfix,
    id: 'prod',
    latestOperation: deploymentOperation({
      id: '12',
      targetVersion: VERSIONS.hotfix,
    }),
    name: 'Prod',
    status: DeploymentStatus.DEPLOYMENT_STATUS_RUNNING,
    versionsBehind: 1,
  }),
  environmentDeployment({
    access: { enable_api: false, enable_site: false },
    currentVersion: VERSIONS.beta,
    id: 'eu-prod',
    latestOperation: deploymentOperation({
      id: '10',
      status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED,
      targetVersion: VERSIONS.sprint42,
    }),
    name: 'EU-Prod',
    status: DeploymentStatus.DEPLOYMENT_STATUS_RUNNING,
    versionsBehind: 2,
  }),
  environmentDeployment({
    access: { enable_api: false, enable_site: false },
    currentVersion: VERSIONS.qa,
    id: 'qa',
    latestOperation: deploymentOperation({
      id: '13',
      targetVersion: VERSIONS.qa,
    }),
    name: 'QA',
    status: DeploymentStatus.DEPLOYMENT_STATUS_RUNNING,
    versionsBehind: 0,
  }),
  environmentDeployment({
    access: { enable_api: false, enable_site: false },
    currentVersion: VERSIONS.qa,
    id: 'sandbox',
    latestOperation: deploymentOperation({
      id: '14',
      targetVersion: VERSIONS.qa,
    }),
    name: 'Sandbox',
    status: DeploymentStatus.DEPLOYMENT_STATUS_RUNNING,
    versionsBehind: 0,
  }),
  environmentDeployment({
    access: { enable_api: false, enable_site: false },
    id: 'preview',
    latestOperation: deploymentOperation({
      id: '15',
      status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED,
      targetVersion: VERSIONS.sprint42,
    }),
    name: 'Preview',
    status: DeploymentStatus.DEPLOYMENT_STATUS_FAILED,
  }),
]

const ACTION_MATRIX_CASES: Array<{
  actions: Array<{
    disabled: boolean
    kind: ReturnType<typeof getEnvironmentDeploymentActions>[number]['kind']
  }>
  name: string
  row: EnvironmentDeployment
}> = [
  {
    actions: [
      { disabled: false, kind: 'deployLatest' },
      { disabled: false, kind: 'changeVersion' },
    ],
    name: 'undeployed',
    row: {
      access: { enable_api: false, enable_site: false },
      environment: {
        description: '',
        display_name: 'Undeployed',
        id: 'undeployed',
        status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
      },
    },
  },
  {
    actions: [
      { disabled: false, kind: 'changeVersion' },
      { disabled: false, kind: 'redeploy' },
      { disabled: false, kind: 'undeploy' },
    ],
    name: 'running the latest version',
    row: environmentDeployment({
      currentVersion: VERSIONS.sprint42,
      id: 'latest',
      name: 'Latest',
      status: DeploymentStatus.DEPLOYMENT_STATUS_RUNNING,
      versionsBehind: 0,
    }),
  },
  {
    actions: [
      { disabled: false, kind: 'deployLatest' },
      { disabled: false, kind: 'changeVersion' },
      { disabled: false, kind: 'redeploy' },
      { disabled: false, kind: 'undeploy' },
    ],
    name: 'running behind the latest version',
    row: environmentDeployment({
      currentVersion: VERSIONS.version02,
      id: 'behind',
      name: 'Behind',
      status: DeploymentStatus.DEPLOYMENT_STATUS_RUNNING,
      versionsBehind: 1,
    }),
  },
  {
    actions: [
      { disabled: true, kind: 'changeVersion' },
      { disabled: true, kind: 'redeploy' },
      { disabled: true, kind: 'undeploy' },
    ],
    name: 'deploying',
    row: environmentDeployment({
      id: 'deploying',
      name: 'Deploying',
      status: DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING,
    }),
  },
  {
    actions: [
      { disabled: true, kind: 'changeVersion' },
      { disabled: true, kind: 'redeploy' },
      { disabled: true, kind: 'undeploy' },
    ],
    name: 'undeploying',
    row: environmentDeployment({
      currentVersion: VERSIONS.qa,
      id: 'undeploying',
      name: 'Undeploying',
      status: DeploymentStatus.DEPLOYMENT_STATUS_UNDEPLOYING,
    }),
  },
  {
    actions: [
      { disabled: false, kind: 'retry' },
      { disabled: false, kind: 'changeVersion' },
    ],
    name: 'failed without a previous version',
    row: environmentDeployment({
      id: 'failed',
      latestOperation: deploymentOperation({
        id: 'failed',
        status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED,
        targetVersion: VERSIONS.sprint42,
      }),
      name: 'Failed',
      status: DeploymentStatus.DEPLOYMENT_STATUS_FAILED,
    }),
  },
  {
    actions: [
      { disabled: false, kind: 'retry' },
      { disabled: false, kind: 'changeVersion' },
      { disabled: false, kind: 'undeploy' },
    ],
    name: 'running after the latest deployment failed',
    row: environmentDeployment({
      currentVersion: VERSIONS.beta,
      id: 'running-failed',
      latestOperation: deploymentOperation({
        id: 'running-failed',
        status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_FAILED,
        targetVersion: VERSIONS.sprint42,
      }),
      name: 'Running failed',
      status: DeploymentStatus.DEPLOYMENT_STATUS_RUNNING,
      versionsBehind: 2,
    }),
  },
  {
    actions: [
      { disabled: false, kind: 'redeploy' },
      { disabled: false, kind: 'undeploy' },
    ],
    name: 'invalid',
    row: environmentDeployment({
      currentVersion: VERSIONS.qa,
      id: 'invalid',
      name: 'Invalid',
      status: DeploymentStatus.DEPLOYMENT_STATUS_INVALID,
    }),
  },
  {
    actions: [
      { disabled: false, kind: 'redeploy' },
      { disabled: false, kind: 'undeploy' },
    ],
    name: 'unknown',
    row: environmentDeployment({
      currentVersion: VERSIONS.qa,
      id: 'unknown',
      name: 'Unknown',
      status: DeploymentStatus.DEPLOYMENT_STATUS_UNSPECIFIED,
    }),
  },
]

const APP_ENVIRONMENTS: AppEnvironment[] = [
  ...APP_ENVIRONMENT_DEPLOYMENTS.map((row) => ({
    description: row.environment.description,
    display_name: row.environment.display_name,
    id: row.environment.id,
    in_use: true,
    status: row.environment.status,
  })),
  ...['Testing', 'Dev', 'Demo', 'US-Prod'].map((name) => ({
    description: '',
    display_name: name,
    id: name.toLowerCase(),
    in_use: false,
    status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
  })),
]
const appEnvironmentsQueryOptions =
  consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
    input: {
      params: {
        app_id: APP_ID,
      },
    },
  })
const appEnvironmentDeploymentsQueryOptions =
  consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryOptions({
    input: {
      params: {
        app_id: APP_ID,
      },
    },
  })
const latestPublishedWorkflowQuery = appWorkflowQueryOptions(APP_ID)
const appWorkflowVersionsQuery = appWorkflowVersionsInfiniteQueryOptions(APP_ID)

function workflowDeploymentPrecheckQueryOptions(workflowId: string) {
  return consoleQuery.enterprise.appDeploy.deploymentService.precheckWorkflowDeployment.queryOptions(
    {
      input: {
        params: {
          app_id: APP_ID,
          workflow_id: workflowId,
        },
      },
      retry: false,
    },
  )
}

function workflowDeploymentOptionsQueryOptions(workflowId: string, environmentId: string) {
  return consoleQuery.enterprise.appDeploy.deploymentService.getWorkflowDeploymentOptions.queryOptions(
    {
      input: {
        params: {
          app_id: APP_ID,
          environment_id: environmentId,
          workflow_id: workflowId,
        },
      },
      retry: false,
    },
  )
}

function seedWorkflowDeploymentConfigurationQueries(queryClient: QueryClient) {
  const workflowIds = new Set([
    ...PUBLISHED_WORKFLOW_VERSIONS.map((workflow) => workflow.id),
    ...Object.values(VERSIONS).map((version) => version.id),
  ])

  workflowIds.forEach((workflowId) => {
    const precheckQuery = workflowDeploymentPrecheckQueryOptions(workflowId)
    queryClient.setQueryDefaults(precheckQuery.queryKey, { staleTime: Infinity })
    queryClient.setQueryData(precheckQuery.queryKey, SUCCESSFUL_WORKFLOW_DEPLOYMENT_PRECHECK)

    APP_ENVIRONMENTS.forEach((environment) => {
      const deploymentOptionsQuery = workflowDeploymentOptionsQueryOptions(
        workflowId,
        environment.id,
      )
      queryClient.setQueryDefaults(deploymentOptionsQuery.queryKey, { staleTime: Infinity })
      queryClient.setQueryData(deploymentOptionsQuery.queryKey, WORKFLOW_DEPLOYMENT_OPTIONS)
    })
  })
}

const mockBuiltInEnvironment = vi.hoisted(() => ({
  appDetail: {
    enable_api: false,
    enable_site: true,
    id: 'app-1',
    maintainer: 'user-2',
    mode: 'workflow',
  },
  mcpServerDetail: {
    status: 'active',
  },
  publishedWorkflow: {
    conversation_variables: [],
    created_at: 1_710_000_100,
    created_by: {
      email: 'alice@example.com',
      id: 'user-2',
      name: 'Alice',
    },
    environment_variables: [],
    features: {},
    graph: {
      nodes: [{ data: { type: 'start' }, id: 'start' }],
    },
    hash: 'hash-workflow-version-7',
    id: 'workflow-version-7',
    marked_comment: 'Production-ready workflow',
    marked_name: 'Release 7',
    rag_pipeline_variables: [],
    tool_published: false,
    updated_at: 1_710_000_200,
    updated_by: {
      email: 'bob@example.com',
      id: 'user-3',
      name: 'Bob',
    } as { email: string; id: string; name: string } | null,
    version: '2026-07-30.1',
  },
}))

function render(
  ui: ReactElement,
  {
    appEnvironments = APP_ENVIRONMENTS,
    environmentDeployments = APP_ENVIRONMENT_DEPLOYMENTS,
    publishedWorkflowVersions = PUBLISHED_WORKFLOW_VERSIONS,
  }: {
    appEnvironments?: AppEnvironment[]
    environmentDeployments?: EnvironmentDeployment[]
    publishedWorkflowVersions?: WorkflowResponse[]
  } = {},
) {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryDefaults(appEnvironmentsQueryOptions.queryKey, {
    staleTime: Infinity,
  })
  queryClient.setQueryDefaults(appEnvironmentDeploymentsQueryOptions.queryKey, {
    staleTime: Infinity,
  })
  queryClient.setQueryData(appEnvironmentsQueryOptions.queryKey, {
    data: appEnvironments,
  })
  queryClient.setQueryData(appEnvironmentDeploymentsQueryOptions.queryKey, {
    environment_deployments: environmentDeployments,
  })
  queryClient.setQueryData(
    latestPublishedWorkflowQuery.queryKey,
    mockBuiltInEnvironment.publishedWorkflow,
  )
  queryClient.setQueryData(appWorkflowVersionsQuery.queryKey, {
    pageParams: [1],
    pages: [
      {
        has_more: false,
        items: publishedWorkflowVersions,
        limit: 10,
        page: 1,
      },
    ],
  })
  seedWorkflowDeploymentConfigurationQueries(queryClient)

  return renderWithConsoleQuery(ui, { queryClient })
}

let appPermissionKeys: string[] = [AppACLPermission.Deploy]
let appDetailAvailable = true
const mockConsoleState = vi.hoisted(() => ({
  workspacePermissionKeys: [] as string[],
}))
const mockDocLink = vi.hoisted(() => vi.fn((path: string) => `https://docs.example.com${path}`))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')

  return createReactI18nextMock({
    'common.operation.cancel': 'Cancel',
    'deployments.deployTab.confirmUndeploy': 'Undeploy',
    'deployments.studio.undeployConfirmDesc':
      'The app will stop running in this environment, and all of its access points will become unavailable.',
    'deployments.studio.undeployConfirmTitle': 'Undeploy {{versionName}} from {{envName}}',
    'deployments.status.RUNTIME_INSTANCE_STATUS_READY': 'Running',
    'deployments.studio.activity.deploySucceeded': 'Deploy {{target}} succeeded',
    'deployments.studio.activity.meta': '{{name}} · {{time}}',
    'deployments.studio.versionValue': 'Version value',
    'deployments.studio.environmentsInUse': '{{used}} of {{total}} environments in use',
    'deployments.studio.environmentVariablesDescription':
      "Use the value from the version you're deploying, keep the last deployed value, or enter a custom one.",
    'deployments.studio.updatedAtBy': 'Updated at {{time}} by {{name}}',
    'workflow.common.publishedBy': 'Published {{time}} by {{author}}',
  })
})

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: (time: number) =>
      time === ACTIVITY_AT * 1000 ? 'activity time' : '17 days ago',
  }),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (timestamp: number) =>
      timestamp === mockBuiltInEnvironment.publishedWorkflow.updated_at
        ? '03-09 16:03'
        : '03-09 16:01',
  }),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: [] }),
  useAllCustomTools: () => ({ data: [] }),
  useAllMCPTools: () => ({
    data: [
      {
        icon: '/notion-mcp.svg',
        id: 'notion',
        name: 'Notion',
        plugin_id: 'langgenius/notion',
      },
    ],
  }),
  useAllWorkflowTools: () => ({ data: [] }),
  useMCPServerDetail: () => ({
    data: mockBuiltInEnvironment.mcpServerDetail,
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const appDetail = appDetailAvailable
      ? {
          ...mockBuiltInEnvironment.appDetail,
          permission_keys: appPermissionKeys,
        }
      : undefined

    return selector({ appDetail })
  },
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState)
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => mockDocLink,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

describe('AppDeploy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appPermissionKeys = [AppACLPermission.Deploy]
    appDetailAvailable = true
    mockBuiltInEnvironment.appDetail.enable_api = false
    mockBuiltInEnvironment.appDetail.enable_site = true
    mockBuiltInEnvironment.mcpServerDetail.status = 'active'
    mockBuiltInEnvironment.publishedWorkflow.graph.nodes = [
      { data: { type: 'start' }, id: 'start' },
    ]
    mockBuiltInEnvironment.publishedWorkflow.updated_by = {
      email: 'bob@example.com',
      id: 'user-3',
      name: 'Bob',
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the built-in environment and contract deployment list', () => {
    render(<AppDeploy />)

    expect(
      screen.getByRole('heading', { name: 'deployments.studio.builtInTitle' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'deployments.studio.environments' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: /Staging/ })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: /Canary/ })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: /Preview/ })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(9)
    expect(screen.getByText('8 of 12 environments in use')).toBeInTheDocument()
  })

  it('links the deploy header to the enterprise deployment documentation', () => {
    render(<AppDeploy />)

    expect(screen.getByRole('link', { name: 'common.operation.learnMore' })).toHaveAttribute(
      'href',
      'https://docs.example.com/use/deploy/overview',
    )
  })

  it.each(ACTION_MATRIX_CASES)(
    'provides the designed row actions when $name',
    ({ actions, row }) => {
      expect(getEnvironmentDeploymentActions(row)).toEqual(actions)
    },
  )

  it('renders version, status, activity, and access from the deployment contract', () => {
    render(<AppDeploy />)

    const canaryRow = within(screen.getByRole('row', { name: /Canary/ }))
    expect(canaryRow.getByRole('button', { name: 'Sprint-42' })).toBeInTheDocument()
    expect(canaryRow.getByText('Running')).toBeInTheDocument()
    expect(canaryRow.getByText('Deploy Sprint-42 succeeded')).toBeInTheDocument()
    expect(canaryRow.getByText('Evan · activity time')).toBeInTheDocument()
    expect(
      canaryRow.getByRole('link', {
        name: 'agentV2.agentDetail.access.webApp.title · agentV2.agentDetail.access.status.inService',
      }),
    ).toHaveAttribute('href', '/app/app-1/access-point?environment=canary&accessPoint=webApp')
    expect(
      canaryRow.getByRole('link', {
        name: 'agentV2.agentDetail.access.serviceApi.title · agentV2.agentDetail.access.status.inService',
      }),
    ).toHaveAttribute('href', '/app/app-1/access-point?environment=canary&accessPoint=serviceApi')
  })

  it('renders the built-in version, access points, and publisher from live app data', () => {
    render(<AppDeploy />)

    const builtInEnvironment = within(
      screen.getByRole('region', { name: 'deployments.studio.builtInTitle' }),
    )

    expect(builtInEnvironment.getByRole('button', { name: 'Release 7' })).toBeInTheDocument()
    expect(builtInEnvironment.queryByRole('button', { name: 'Sprint-42' })).not.toBeInTheDocument()
    expect(
      builtInEnvironment.getByRole('link', {
        name: 'agentV2.agentDetail.access.webApp.title · agentV2.agentDetail.access.status.inService',
      }),
    ).toHaveAttribute('href', '/app/app-1/access-point?environment=built-in&accessPoint=webApp')
    expect(
      builtInEnvironment.getByRole('button', {
        name: 'agentV2.agentDetail.access.serviceApi.title · agentV2.agentDetail.access.status.outOfService',
      }),
    ).toBeDisabled()
    expect(
      builtInEnvironment.getByRole('link', {
        name: 'MCP · agentV2.agentDetail.access.status.inService',
      }),
    ).toHaveAttribute('href', '/app/app-1/access-point?environment=built-in&accessPoint=mcp')
    expect(
      builtInEnvironment.getByRole('button', {
        name: 'common.settings.trigger · agentV2.agentDetail.access.status.outOfService',
      }),
    ).toBeDisabled()
    expect(builtInEnvironment.getByText('Updated at 03-09 16:03 by Bob')).toBeInTheDocument()
  })

  it('shows only the trigger access point as active for a published trigger workflow', () => {
    mockBuiltInEnvironment.appDetail.enable_api = true
    mockBuiltInEnvironment.publishedWorkflow.graph.nodes = [
      { data: { type: 'trigger-webhook' }, id: 'trigger' },
    ]

    render(<AppDeploy />)

    const builtInEnvironment = within(
      screen.getByRole('region', { name: 'deployments.studio.builtInTitle' }),
    )

    expect(
      builtInEnvironment.getByRole('button', {
        name: 'agentV2.agentDetail.access.webApp.title · agentV2.agentDetail.access.status.outOfService',
      }),
    ).toBeDisabled()
    expect(
      builtInEnvironment.getByRole('button', {
        name: 'agentV2.agentDetail.access.serviceApi.title · agentV2.agentDetail.access.status.outOfService',
      }),
    ).toBeDisabled()
    expect(
      builtInEnvironment.getByRole('button', {
        name: 'MCP · agentV2.agentDetail.access.status.outOfService',
      }),
    ).toBeDisabled()
    expect(
      builtInEnvironment.getByRole('link', {
        name: 'common.settings.trigger · agentV2.agentDetail.access.status.inService',
      }),
    ).toHaveAttribute('href', '/app/app-1/access-point?environment=built-in&accessPoint=trigger')
  })

  it('uses the publisher when the published workflow has no later updater', () => {
    mockBuiltInEnvironment.publishedWorkflow.updated_by = null

    render(<AppDeploy />)

    const builtInEnvironment = within(
      screen.getByRole('region', { name: 'deployments.studio.builtInTitle' }),
    )
    expect(builtInEnvironment.getByText('Updated at 03-09 16:03 by Alice')).toBeInTheDocument()
  })

  it('shows loading while the app detail is unavailable', () => {
    appDetailAvailable = false

    render(<AppDeploy />)

    expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'common.appMenus.deploy' }),
    ).not.toBeInTheDocument()
  })

  it('does not render deployment controls without app deploy ACL permission', () => {
    appPermissionKeys = []

    render(<AppDeploy />)

    expect(
      screen.queryByRole('heading', { name: 'common.appMenus.deploy' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'deployments.studio.environments' }),
    ).not.toBeInTheDocument()
  })

  it('opens the deploy menu with undeployed environments', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    await user.click(screen.getByRole('button', { name: 'common.appMenus.deploy' }))

    expect(screen.getByText('deployments.card.notDeployed')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Testing/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /US-Prod/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Canary/ })).not.toBeInTheDocument()
  })

  it('shows an empty hint when every environment is already deployed', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />, {
      appEnvironments: APP_ENVIRONMENTS.map((environment) => ({
        ...environment,
        in_use: true,
      })),
    })

    await user.click(screen.getByRole('button', { name: 'common.appMenus.deploy' }))

    expect(screen.getByRole('status')).toHaveTextContent(
      'deployments.deployDrawer.noNewEnvironmentAvailable',
    )
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('opens the selected environment version picker from the deploy menu', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    await user.click(screen.getByRole('button', { name: 'common.appMenus.deploy' }))
    await user.click(await screen.findByRole('menuitem', { name: /Dev/ }))

    const dialog = await screen.findByRole('dialog', {
      name: 'deployments.versions.deployTo:{"name":"Dev"}',
    })
    expect(within(dialog).getByText('deployments.studio.chooseVersionToDeploy')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Release 7/ })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: /Sprint-42/ })).toBeEnabled()
    expect(within(dialog).queryByText('deployments.studio.current')).not.toBeInTheDocument()
    expect(within(dialog).getByText('Latest production workflow')).toBeInTheDocument()
    expect(within(dialog).getByText('Published 17 days ago by Alice')).toBeInTheDocument()
  })

  it('links to the workflow publisher when the version picker has no published versions', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />, { publishedWorkflowVersions: [] })

    await user.click(screen.getByRole('button', { name: 'common.appMenus.deploy' }))
    await user.click(await screen.findByRole('menuitem', { name: /Dev/ }))

    const dialog = await screen.findByRole('dialog', {
      name: 'deployments.versions.deployTo:{"name":"Dev"}',
    })
    expect(
      within(dialog).getByText('deployments.studio.accessPoint.noPublishedTitle'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('link', {
        name: 'deployments.studio.accessPoint.goToPublish',
      }),
    ).toHaveAttribute('href', '/app/app-1/workflow')
  })

  it('continues from version selection to deployment configuration', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    await user.click(screen.getByRole('button', { name: 'common.appMenus.deploy' }))
    await user.click(screen.getByRole('menuitem', { name: /Dev/ }))
    const versionDialog = await screen.findByRole('dialog', {
      name: 'deployments.versions.deployTo:{"name":"Dev"}',
    })
    await user.click(within(versionDialog).getByRole('button', { name: /Release 6/ }))

    const configurationDialog = await screen.findByRole('dialog', {
      name: 'deployments.studio.deployConfiguration',
    })
    expect(within(configurationDialog).getByText('Release 6')).toBeInTheDocument()
    expect(within(configurationDialog).getByText('Dev')).toBeInTheDocument()
    expect(
      within(configurationDialog).getByRole('combobox', { name: 'Moonshot' }),
    ).toHaveTextContent('Enterprise deployment key')
    expect(
      within(configurationDialog).getByRole('button', { name: 'common.appMenus.deploy' }),
    ).toBeEnabled()
    expect(
      within(configurationDialog).getByText(
        "Use the value from the version you're deploying, keep the last deployed value, or enter a custom one.",
      ),
    ).toBeInTheDocument()

    const portSource = within(configurationDialog).getByRole('combobox', { name: /PORT/ })
    expect(portSource).toHaveTextContent('Version value')
    const portInput = within(configurationDialog).getByRole('textbox', { name: 'PORT' })
    expect(portInput).toBeDisabled()
    expect(portInput).toHaveAttribute('placeholder', '2')
    expect(within(configurationDialog).getByRole('textbox', { name: 'API_KEY' })).toHaveAttribute(
      'placeholder',
      'sk-123************bc',
    )
    expect(within(configurationDialog).getByRole('textbox', { name: 'name' })).toHaveAttribute(
      'placeholder',
      'environment variable 01',
    )

    await user.click(portSource)
    expect(
      await screen.findByRole('option', {
        name: 'deployments.deployDrawer.envVarSource.literal',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Version value' })).toBeInTheDocument()
    expect(
      screen.getByRole('option', {
        name: 'deployments.deployDrawer.envVarSource.lastDeployment',
      }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('option', {
        name: 'deployments.deployDrawer.envVarSource.literal',
      }),
    )

    const customPortInput = within(configurationDialog).getByRole('spinbutton', { name: 'PORT' })
    expect(customPortInput).toBeEnabled()
    await user.clear(customPortInput)
    await user.type(customPortInput, '3000')
    expect(customPortInput).toHaveValue(3000)

    await user.click(
      within(configurationDialog).getByRole('button', { name: 'common.operation.back' }),
    )
    expect(
      await screen.findByRole('dialog', {
        name: 'deployments.versions.deployTo:{"name":"Dev"}',
      }),
    ).toBeInTheDocument()
  })

  it('deploys the selected workflow configuration and refreshes the deployment list', async () => {
    const user = userEvent.setup()
    const requests: Request[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request.clone())

      if (request.url.includes('/deployment:deploy')) {
        return new Response(
          JSON.stringify({
            operation: {
              id: 'operation-dev',
              status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS,
              type: DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_DEPLOY,
            },
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }

      if (request.url.includes('/workflows/environment-deployments')) {
        return new Response(
          JSON.stringify({
            environment_deployments: [
              ...APP_ENVIRONMENT_DEPLOYMENTS,
              environmentDeployment({
                id: 'dev',
                latestOperation: deploymentOperation({
                  id: 'operation-dev',
                  status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS,
                  targetVersion: workflowVersion('Release 6', 'workflow-version-6'),
                }),
                name: 'Dev',
                status: DeploymentStatus.DEPLOYMENT_STATUS_DEPLOYING,
              }),
            ],
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }

      if (
        new URL(request.url).pathname.endsWith('/enterprise/app-deploy/apps/app-1/environments')
      ) {
        return new Response(
          JSON.stringify({
            data: APP_ENVIRONMENTS.map((environment) =>
              environment.id === 'dev' ? { ...environment, in_use: true } : environment,
            ),
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })
    render(<AppDeploy />)

    await user.click(screen.getByRole('button', { name: 'common.appMenus.deploy' }))
    await user.click(screen.getByRole('menuitem', { name: /Dev/ }))
    const versionDialog = await screen.findByRole('dialog', {
      name: 'deployments.versions.deployTo:{"name":"Dev"}',
    })
    await user.click(within(versionDialog).getByRole('button', { name: /Release 6/ }))

    const configurationDialog = await screen.findByRole('dialog', {
      name: 'deployments.studio.deployConfiguration',
    })
    await user.click(within(configurationDialog).getByRole('combobox', { name: 'Moonshot' }))
    await user.click(await screen.findByRole('option', { name: 'Development key' }))
    await user.click(within(configurationDialog).getByRole('combobox', { name: /PORT/ }))
    await user.click(
      await screen.findByRole('option', {
        name: 'deployments.deployDrawer.envVarSource.literal',
      }),
    )
    await user.type(within(configurationDialog).getByRole('spinbutton', { name: 'PORT' }), '3000')
    await user.click(
      within(configurationDialog).getByRole('button', { name: 'common.appMenus.deploy' }),
    )

    expect(
      await screen.findByRole('row', {
        name: /Dev/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('9 of 12 environments in use')).toBeInTheDocument()
    expect(
      screen.queryByRole('dialog', {
        name: 'deployments.studio.deployConfiguration',
      }),
    ).not.toBeInTheDocument()

    const deployRequest = requests.find((request) => request.url.includes('/deployment:deploy'))
    if (!deployRequest) throw new Error('Expected the workflow deployment request.')

    expect(deployRequest.method).toBe('POST')
    expect(new URL(deployRequest.url).pathname).toBe(
      '/console/api/enterprise/app-deploy/apps/app-1/workflows/workflow-version-6/environments/dev/deployment:deploy',
    )
    expect(await deployRequest.json()).toEqual({
      credentials: [
        {
          category: PluginCategory.PLUGIN_CATEGORY_MODEL,
          credential_id: 'development',
          provider_id: 'moonshot',
        },
        {
          category: PluginCategory.PLUGIN_CATEGORY_TOOL,
          credential_id: 'github-oauth',
          provider_id: 'github',
        },
      ],
      environment_variables: [
        {
          key: 'PORT',
          value: '3000',
          value_source: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_CUSTOM,
        },
        {
          key: 'API_KEY',
          value_source: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_CONFIGURED,
        },
        {
          key: 'name',
          value_source: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYED,
        },
      ],
    })
    expect(
      requests.filter((request) => request.url.includes('/workflows/environment-deployments')),
    ).toHaveLength(1)
    expect(
      requests.filter((request) =>
        new URL(request.url).pathname.endsWith('/enterprise/app-deploy/apps/app-1/environments'),
      ),
    ).toHaveLength(1)
  })

  it('undeploys the current workflow version and refreshes the environment data', async () => {
    const user = userEvent.setup()
    const requests: Request[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request.clone())

      if (request.url.includes('/deployment:undeploy')) {
        return new Response(
          JSON.stringify({
            operation: {
              id: 'operation-canary-undeploy',
              status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS,
              type: DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_UNDEPLOY,
            },
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }

      if (request.url.includes('/workflows/environment-deployments')) {
        return new Response(
          JSON.stringify({
            environment_deployments: APP_ENVIRONMENT_DEPLOYMENTS.map((deployment) =>
              deployment.environment.id === 'canary'
                ? environmentDeployment({
                    currentVersion: VERSIONS.sprint42,
                    id: 'canary',
                    latestOperation: deploymentOperation({
                      id: 'operation-canary-undeploy',
                      status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS,
                      type: DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_UNDEPLOY,
                    }),
                    name: 'Canary',
                    status: DeploymentStatus.DEPLOYMENT_STATUS_UNDEPLOYING,
                  })
                : deployment,
            ),
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }

      if (
        new URL(request.url).pathname.endsWith('/enterprise/app-deploy/apps/app-1/environments')
      ) {
        return new Response(
          JSON.stringify({
            data: APP_ENVIRONMENTS.map((environment) =>
              environment.id === 'canary' ? { ...environment, in_use: false } : environment,
            ),
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })
    render(<AppDeploy />)

    const canaryRow = screen.getByRole('row', { name: /Canary/ })
    await user.click(
      within(canaryRow).getByRole('button', {
        name: 'Canary · deployments.deployTab.moreActions',
      }),
    )
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'deployments.deployTab.undeploy',
      }),
    )
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Undeploy Sprint-42 from Canary',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Undeploy' }))

    expect(await screen.findByText('7 of 12 environments in use')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    const undeployRequest = requests.find((request) => request.url.includes('/deployment:undeploy'))
    if (!undeployRequest) throw new Error('Expected the workflow undeployment request.')

    expect(undeployRequest.method).toBe('POST')
    expect(new URL(undeployRequest.url).pathname).toBe(
      '/console/api/enterprise/app-deploy/apps/app-1/workflows/sprint-42/environments/canary/deployment:undeploy',
    )
    expect(
      requests.filter((request) => request.url.includes('/workflows/environment-deployments')),
    ).toHaveLength(1)
    expect(
      requests.filter((request) =>
        new URL(request.url).pathname.endsWith('/enterprise/app-deploy/apps/app-1/environments'),
      ),
    ).toHaveLength(1)
  })

  it('shows deploy API failures through the fetch toast without an inline configuration error', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)

      if (request.url.includes('/deployment:deploy')) {
        return new Response(JSON.stringify({ message: 'Deployment service unavailable' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 502,
        })
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })
    render(<AppDeploy />)

    await user.click(screen.getByRole('button', { name: 'common.appMenus.deploy' }))
    await user.click(screen.getByRole('menuitem', { name: /Dev/ }))
    const versionDialog = await screen.findByRole('dialog', {
      name: 'deployments.versions.deployTo:{"name":"Dev"}',
    })
    await user.click(within(versionDialog).getByRole('button', { name: /Release 6/ }))

    const configurationDialog = await screen.findByRole('dialog', {
      name: 'deployments.studio.deployConfiguration',
    })
    await user.click(
      within(configurationDialog).getByRole('button', { name: 'common.appMenus.deploy' }),
    )

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Deployment service unavailable')
    })
    expect(configurationDialog).toBeInTheDocument()
    expect(within(configurationDialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refreshes all environments after deployment polling finishes', async () => {
    const requests: Request[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      requests.push(request.clone())

      if (
        new URL(request.url).pathname.endsWith('/enterprise/app-deploy/apps/app-1/environments')
      ) {
        return new Response(
          JSON.stringify({
            data: APP_ENVIRONMENTS.map((environment) =>
              environment.id === 'canary' ? { ...environment, in_use: false } : environment,
            ),
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    })
    const view = render(<AppDeploy />, {
      environmentDeployments: [
        environmentDeployment({
          currentVersion: VERSIONS.sprint42,
          id: 'canary',
          latestOperation: deploymentOperation({
            id: 'operation-canary-undeploy',
            status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_IN_PROGRESS,
            type: DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_UNDEPLOY,
          }),
          name: 'Canary',
          status: DeploymentStatus.DEPLOYMENT_STATUS_UNDEPLOYING,
        }),
      ],
    })
    expect(screen.getByText('8 of 12 environments in use')).toBeInTheDocument()

    act(() => {
      view.queryClient.setQueryData(appEnvironmentDeploymentsQueryOptions.queryKey, {
        environment_deployments: [],
      })
    })

    expect(await screen.findByText('7 of 12 environments in use')).toBeInTheDocument()
    expect(
      requests.filter((request) =>
        new URL(request.url).pathname.endsWith('/enterprise/app-deploy/apps/app-1/environments'),
      ),
    ).toHaveLength(1)
  })

  it('blocks deployment when the selected workflow fails precheck', async () => {
    const user = userEvent.setup()
    const view = render(<AppDeploy />)
    const precheckQuery = workflowDeploymentPrecheckQueryOptions('workflow-version-6')
    const deploymentOptionsQuery = workflowDeploymentOptionsQueryOptions(
      'workflow-version-6',
      'dev',
    )
    view.queryClient.setQueryData(precheckQuery.queryKey, {
      unsupported_nodes: [
        {
          id: 'node-1',
          title: 'Request approval',
          type: 'human-input',
        },
        {
          id: 'node-2',
          provider: {
            plugin_id: 'langgenius/notion',
            provider_id: 'notion',
            provider_name: 'Notion',
            provider_type: 'mcp',
          },
          title: 'Notion MCP',
          type: 'tool',
        },
      ],
    })
    view.queryClient.removeQueries({
      exact: true,
      queryKey: deploymentOptionsQuery.queryKey,
    })

    await user.click(screen.getByRole('button', { name: 'common.appMenus.deploy' }))
    await user.click(screen.getByRole('menuitem', { name: /Dev/ }))
    const versionDialog = await screen.findByRole('dialog', {
      name: 'deployments.versions.deployTo:{"name":"Dev"}',
    })
    await user.click(within(versionDialog).getByRole('button', { name: /Release 6/ }))

    const configurationDialog = await screen.findByRole('dialog', {
      name: 'deployments.studio.deployConfiguration',
    })
    const precheckAlert = await within(configurationDialog).findByRole('alert')
    expect(precheckAlert).toHaveTextContent('Request approval')
    expect(precheckAlert).toHaveTextContent('Notion MCP')
    expect(precheckAlert).not.toHaveTextContent('node-1')
    const notionNode = within(precheckAlert).getByText('Notion MCP').closest('li')
    expect(notionNode?.querySelector<HTMLElement>('[style]')?.style.backgroundImage).toContain(
      '/notion-mcp.svg',
    )
    expect(
      within(configurationDialog).getByRole('button', { name: 'common.appMenus.deploy' }),
    ).toBeDisabled()
    expect(within(configurationDialog).queryByRole('combobox', { name: 'Moonshot' })).toBeNull()
    expect(view.queryClient.getQueryState(deploymentOptionsQuery.queryKey)?.fetchStatus).not.toBe(
      'fetching',
    )
  })

  it('opens the latest version configuration and allows choosing another version', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    const preReleaseRow = screen.getByRole('row', { name: /Pre-release/ })
    await user.click(
      within(preReleaseRow).getByRole('button', {
        name: 'deployments.studio.deployLatest',
      }),
    )

    const configurationDialog = await screen.findByRole('dialog', {
      name: 'deployments.studio.deployConfiguration',
    })
    expect(within(configurationDialog).getByText('Release 7')).toBeInTheDocument()
    expect(within(configurationDialog).getByText('Pre-release')).toBeInTheDocument()

    await user.click(
      within(configurationDialog).getByRole('button', { name: 'common.operation.back' }),
    )

    expect(
      await screen.findByRole('dialog', {
        name: 'deployments.studio.changeVersion · Pre-release',
      }),
    ).toBeInTheDocument()
  })

  it('opens the failed version configuration for retry without a version-selection step', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    const previewRow = screen.getByRole('row', { name: /Preview/ })
    await user.click(
      within(previewRow).getByRole('button', {
        name: 'deployments.studio.retryVersion:{"version":"Sprint-42"}',
      }),
    )

    const configurationDialog = await screen.findByRole('dialog', {
      name: 'deployments.studio.deployConfiguration',
    })
    expect(within(configurationDialog).getByText('Sprint-42')).toBeInTheDocument()
    expect(within(configurationDialog).getByText('Preview')).toBeInTheDocument()
    expect(
      within(configurationDialog).queryByRole('button', { name: 'common.operation.back' }),
    ).not.toBeInTheDocument()
  })

  it('opens redeploy configuration without a version-selection step', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    const qaRow = within(screen.getByRole('row', { name: /QA/ }))
    await user.click(
      qaRow.getByRole('button', {
        name: 'QA · deployments.deployTab.moreActions',
      }),
    )
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', {
        name: 'deployments.deployTab.redeploy',
      }),
    )

    const configurationDialog = await screen.findByRole('dialog', {
      name: 'deployments.studio.deployConfiguration',
    })
    expect(within(configurationDialog).getByText('v0.3-beta')).toBeInTheDocument()
    expect(within(configurationDialog).getByText('QA')).toBeInTheDocument()
    expect(
      within(configurationDialog).queryByRole('button', { name: 'common.operation.back' }),
    ).not.toBeInTheDocument()
  })

  it('opens change version for the selected deployed environment', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    const canaryRow = within(screen.getByRole('row', { name: /Canary/ }))
    await user.click(
      canaryRow.getByRole('button', {
        name: 'deployments.studio.changeVersion',
      }),
    )

    const dialog = await screen.findByRole('dialog', {
      name: 'deployments.studio.changeVersion · Canary',
    })
    expect(within(dialog).getByRole('button', { name: /Sprint-42/ })).toBeDisabled()
    expect(within(dialog).getByText('deployments.studio.current')).toBeInTheDocument()
  })

  it('shows the empty deployment state when there are no environments in use', async () => {
    const user = userEvent.setup()
    render(
      <AppDeployStateBoundary appId={APP_ID}>
        <EnvironmentTable appId={APP_ID} />
      </AppDeployStateBoundary>,
      {
        appEnvironments: APP_ENVIRONMENTS.map((environment) => ({
          ...environment,
          in_use: false,
        })),
        environmentDeployments: [],
      },
    )

    expect(screen.getByText('deployments.list.emptyTitle')).toBeInTheDocument()
    expect(screen.getByText('deployments.studio.emptyDescription')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.retry' })).not.toBeInTheDocument()

    const deployButtons = screen.getAllByRole('button', {
      name: 'common.appMenus.deploy',
    })
    expect(deployButtons).toHaveLength(2)
    await user.click(deployButtons[1]!)

    expect(screen.getByText('deployments.card.notDeployed')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Testing/ })).toBeInTheDocument()
  })

  it('shows loading and retries after the environment deployment list fails', async () => {
    const user = userEvent.setup()
    const deploymentRequests: Request[] = []
    let resolveInitialRequest: ((response: Response) => void) | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (
        !new URL(request.url).pathname.endsWith(
          '/enterprise/app-deploy/apps/app-1/workflows/environment-deployments',
        )
      )
        throw new Error(`Unexpected request: ${request.method} ${request.url}`)

      deploymentRequests.push(request.clone())
      if (deploymentRequests.length === 1) {
        return new Promise((resolve) => {
          resolveInitialRequest = resolve
        })
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            environment_deployments: APP_ENVIRONMENT_DEPLOYMENTS,
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        ),
      )
    })
    const queryClient = createConsoleQueryClient()
    queryClient.setQueryData(appEnvironmentsQueryOptions.queryKey, {
      data: APP_ENVIRONMENTS,
    })

    renderWithConsoleQuery(
      <AppDeployStateBoundary appId={APP_ID}>
        <EnvironmentTable appId={APP_ID} />
      </AppDeployStateBoundary>,
      { queryClient },
    )

    expect(screen.getByRole('status', { name: /loading/ })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(deploymentRequests).toHaveLength(1)
    })

    resolveInitialRequest?.(
      new Response(JSON.stringify({ message: 'Failed to load deployments' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      }),
    )

    const retryButton = await screen.findByRole('button', {
      name: 'common.operation.retry',
    })
    expect(screen.getByRole('heading', { name: 'common.errorBoundary.title' })).toBeInTheDocument()
    expect(screen.getByText('deployments.common.loadFailed')).toBeInTheDocument()
    expect(screen.queryByText('deployments.list.emptyTitle')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    await user.click(retryButton)

    expect(await screen.findByRole('cell', { name: /Staging/ })).toBeInTheDocument()
    expect(deploymentRequests).toHaveLength(2)
  })

  it('shows the environment actions from the design menu', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    const canaryRow = screen.getByRole('row', { name: /Canary/ })
    await user.click(
      within(canaryRow).getByRole('button', {
        name: 'Canary · deployments.deployTab.moreActions',
      }),
    )

    const menu = await screen.findByRole('menu', {
      name: 'Canary · deployments.deployTab.moreActions',
    })
    expect(
      within(menu).getByRole('menuitem', { name: 'deployments.deployTab.redeploy' }),
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitem', { name: 'deployments.deployTab.undeploy' }),
    ).toBeInTheDocument()
    expect(
      within(menu).queryByRole('menuitem', {
        name: 'deployments.studio.changeVersion',
      }),
    ).not.toBeInTheDocument()
  })

  it('exposes only the first action and moves every remaining action into More', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    const preReleaseRow = within(screen.getByRole('row', { name: /Pre-release/ }))
    expect(
      preReleaseRow.getByRole('button', {
        name: 'deployments.studio.deployLatest',
      }),
    ).toBeInTheDocument()

    await user.click(
      preReleaseRow.getByRole('button', {
        name: 'Pre-release · deployments.deployTab.moreActions',
      }),
    )

    const menu = within(
      await screen.findByRole('menu', {
        name: 'Pre-release · deployments.deployTab.moreActions',
      }),
    )
    expect(
      menu.getByRole('menuitem', { name: 'deployments.studio.changeVersion' }),
    ).toBeInTheDocument()
    expect(
      menu.getByRole('menuitem', { name: 'deployments.deployTab.redeploy' }),
    ).toBeInTheDocument()
    expect(
      menu.getByRole('menuitem', { name: 'deployments.deployTab.undeploy' }),
    ).toBeInTheDocument()
    expect(
      menu.queryByRole('menuitem', { name: 'deployments.studio.deployLatest' }),
    ).not.toBeInTheDocument()
  })

  it('disables every row action while deployment is in progress', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    const stagingRow = within(screen.getByRole('row', { name: /Staging/ }))
    expect(
      stagingRow.getByRole('button', {
        name: 'deployments.studio.changeVersion',
      }),
    ).toBeDisabled()

    await user.click(
      stagingRow.getByRole('button', {
        name: 'Staging · deployments.deployTab.moreActions',
      }),
    )

    const menuItems = within(await screen.findByRole('menu')).getAllByRole('menuitem')
    expect(menuItems).toHaveLength(2)
    for (const item of menuItems) expect(item).toHaveAttribute('aria-disabled', 'true')
  })

  it('asks for confirmation before undeploying an environment', async () => {
    const user = userEvent.setup()
    const onUndeploy = vi.fn()
    render(
      <AppDeployStateBoundary appId={APP_ID}>
        <EnvironmentTable appId={APP_ID} onUndeploy={onUndeploy} />
      </AppDeployStateBoundary>,
    )

    const canaryRow = screen.getByRole('row', { name: /Canary/ })
    await user.click(
      within(canaryRow).getByRole('button', {
        name: 'Canary · deployments.deployTab.moreActions',
      }),
    )
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'deployments.deployTab.undeploy',
      }),
    )

    const dialog = await screen.findByRole('alertdialog', {
      name: 'Undeploy Sprint-42 from Canary',
    })
    expect(
      within(dialog).getByText(
        'The app will stop running in this environment, and all of its access points will become unavailable.',
      ),
    ).toBeInTheDocument()
    expect(onUndeploy).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onUndeploy).not.toHaveBeenCalled()
  })

  it('undeploys the selected environment after confirmation', async () => {
    const user = userEvent.setup()
    const onUndeploy = vi.fn()
    render(
      <AppDeployStateBoundary appId={APP_ID}>
        <EnvironmentTable appId={APP_ID} onUndeploy={onUndeploy} />
      </AppDeployStateBoundary>,
    )

    const canaryRow = screen.getByRole('row', { name: /Canary/ })
    await user.click(
      within(canaryRow).getByRole('button', {
        name: 'Canary · deployments.deployTab.moreActions',
      }),
    )
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'deployments.deployTab.undeploy',
      }),
    )
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Undeploy Sprint-42 from Canary',
    })

    await user.click(within(dialog).getByRole('button', { name: 'Undeploy' }))

    expect(onUndeploy).toHaveBeenCalledOnce()
    expect(onUndeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: expect.objectContaining({ id: 'canary' }),
      }),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('shows the version description from the deployment contract on hover', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    const canaryRow = screen.getByRole('row', { name: /Canary/ })
    await user.hover(within(canaryRow).getByRole('button', { name: 'Sprint-42' }))

    expect(
      await screen.findByText(
        'Fixed several critical bugs affecting data synchronization and optimized page loading speed. Enhanced system stability and user experience through backend improvements.',
      ),
    ).toBeInTheDocument()
  })

  it('shows the built-in published workflow details on hover', async () => {
    const user = userEvent.setup()
    render(<AppDeploy />)

    const builtInSection = screen
      .getByRole('heading', { name: 'deployments.studio.builtInTitle' })
      .closest('section')
    if (!builtInSection) throw new Error('Built-in environment section was not rendered')
    await user.hover(within(builtInSection).getByRole('button', { name: 'Release 7' }))

    expect(await screen.findByText('Published 17 days ago by Alice')).toBeInTheDocument()
    expect(screen.getByText('Production-ready workflow')).toBeInTheDocument()
  })
})
