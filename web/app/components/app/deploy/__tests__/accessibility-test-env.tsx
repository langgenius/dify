import type {
  EnvironmentDeployment,
  GetWorkflowDeploymentOptionsResponse,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import {
  EnvironmentStatus,
  EnvVarValueType,
  PluginCategory,
  RuntimeState,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import axe from 'axe-core'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import agentV2 from '@/i18n/locales/en-US/agent-v-2.json'
import appDebug from '@/i18n/locales/en-US/app-debug.json'
import common from '@/i18n/locales/en-US/common.json'
import deployments from '@/i18n/locales/en-US/deployments.json'
import modelProvider from '@/i18n/locales/en-US/model-provider.json'
import navigation from '@/i18n/locales/en-US/navigation.json'
import plugin from '@/i18n/locales/en-US/plugin.json'
import workflowHistory from '@/i18n/locales/en-US/workflow-history.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import { consoleQuery } from '@/service/console'
import {
  appWorkflowQueryOptions,
  appWorkflowVersionsInfiniteQueryOptions,
} from '@/service/workflow-queries'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import {
  createConsoleQueryClient,
  createConsoleQueryWrapper,
  seedAppDetail,
} from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { AppACLPermission } from '@/utils/permission'
import AppDeploy from '..'

const appId = 'deploy-audit'
export const environment = {
  id: 'canary',
  display_name: 'Canary',
  description: '',
  status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
}
export const deployment: EnvironmentDeployment = {
  deployment_id: 'deployment-canary',
  environment,
  access: { enable_api: true, enable_site: true },
  deployment: {
    current_version: { id: 'release-0', marked_name: 'Release 0', version: '1' },
    runtimeState: RuntimeState.RUNTIME_STATE_RUNNING,
    versions_behind: 1,
  },
}
const options: GetWorkflowDeploymentOptionsResponse = {
  credential_slots: [
    {
      provider_id: 'deepseek',
      category: PluginCategory.PLUGIN_CATEGORY_MODEL,
      workflow_as_tool_dependency: {
        paths: [
          {
            workflows: [
              {
                app_id: 'source-workflow',
                workflow_id: 'source-release',
                name: 'Customer support workflow',
                icon_type: 'emoji',
                icon: '',
                icon_background: '#FFFFFF',
              },
            ],
          },
        ],
      },
      candidates: ['Production key', 'Development key'].map((name) => ({
        credential_id: name,
        display_name: name,
        provider_id: 'deepseek',
        category: PluginCategory.PLUGIN_CATEGORY_MODEL,
        from_enterprise: false,
      })),
    },
  ],
  environment_variable_groups: [
    {
      from_app: {
        app_id: appId,
        workflow_id: 'release-1',
        name: 'Finance app',
        icon_type: 'emoji',
        icon: '',
        icon_background: '#FFFFFF',
      },
      environment_variable_slots: [
        {
          key: 'PORT',
          description: 'Server port',
          value_type: EnvVarValueType.ENV_VAR_VALUE_TYPE_NUMBER,
          has_configured_value: false,
          has_last_deployed_value: false,
        },
      ],
    },
  ],
}

export async function renderDeploy({
  withLLM = false,
  environmentDeployments = [deployment],
}: {
  withLLM?: boolean
  environmentDeployments?: EnvironmentDeployment[]
} = {}) {
  if (withLLM) await import('@/app/components/workflow/llm-environment-variable-value-field')
  document.documentElement.lang = 'en'
  document.title = 'Deploy accessibility audit'
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: {
      'en-US': {
        agentV2,
        appDebug,
        common,
        deployments,
        modelProvider,
        navigation,
        plugin,
        workflow,
        workflowHistory,
      },
    },
  })
  const client = createConsoleQueryClient()
  if (withLLM) {
    seedModelProviderQueries(client, [
      createModelCatalogFixture({
        provider: 'langgenius/openai/openai',
        models: [
          createCatalogModelFixture({
            model: 'chat-model',
            label: { en_US: 'Chat model' },
            model_properties: { mode: 'chat' },
          }),
        ],
      }),
    ])
    client.setQueryDefaults(
      consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
      {
        initialData: {
          data: [
            {
              name: 'instruction',
              label: { en_US: 'System instruction' },
              type: 'text',
              default: '',
              required: true,
            },
          ],
        },
      },
    )
  }
  seedAppDetail(
    client,
    createAppDetailFixture({
      id: appId,
      mode: 'workflow',
      maintainer: 'user-2',
      enable_api: true,
      enable_site: true,
      permission_keys: [AppACLPermission.Deploy, AppACLPermission.AccessPointView],
    }),
  )
  const published = createWorkflowResponseFixture({
    id: 'release-1',
    marked_name: 'Release 1',
    marked_comment: 'Latest production workflow',
    graph: { nodes: [{ id: 'start', data: { type: 'start' } }] },
  })
  client.setQueryData(appWorkflowQueryOptions(appId).queryKey, published)
  client.setQueryData(appWorkflowVersionsInfiniteQueryOptions(appId).queryKey, {
    pages: [{ items: [published], page: 1, limit: 10, has_more: false }],
    pageParams: [1],
  })
  const params = { app_id: appId }
  client.setQueryData(consoleQuery.apps.byAppId.server.get.queryKey({ input: { params } }), {
    id: 'audit-mcp',
    name: 'MCP',
    server_code: 'audit',
    description: '',
    parameters: {},
    status: 'inactive',
  })
  client.setQueryData(
    consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryKey({
      input: { params },
    }),
    {
      data: [
        {
          ...environment,
          in_use: environmentDeployments.some((row) => row.environment.id === environment.id),
        },
        { ...environment, id: 'dev', display_name: 'Dev', in_use: false },
      ],
    },
  )
  client.setQueryData(
    consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryKey({
      input: { params },
    }),
    {
      environment_deployments: environmentDeployments,
    },
  )
  for (const workflowId of ['release-0', published.id]) {
    client.setQueryData(
      consoleQuery.enterprise.appDeploy.deploymentService.precheckWorkflowDeployment.queryKey({
        input: { params: { ...params, workflow_id: workflowId } },
      }),
      { unsupported_nodes: [] },
    )
    for (const environmentId of ['canary', 'dev']) {
      client.setQueryData(
        consoleQuery.enterprise.appDeploy.deploymentService.getWorkflowDeploymentOptions.queryKey({
          input: { params: { ...params, workflow_id: workflowId, environment_id: environmentId } },
        }),
        withLLM
          ? {
              ...options,
              environment_variable_groups: [
                {
                  ...options.environment_variable_groups[0]!,
                  environment_variable_slots: [
                    {
                      key: 'MODEL',
                      description: 'Chat model used by the workflow',
                      value_type: EnvVarValueType.ENV_VAR_VALUE_TYPE_LLM,
                      has_configured_value: true,
                      has_last_deployed_value: false,
                      configured_value: {
                        provider: 'langgenius/openai/openai',
                        name: 'chat-model',
                        mode: 'chat',
                        completion_params: {},
                      },
                    },
                  ],
                },
              ],
            }
          : options,
      )
    }
  }
  const { wrapper: Wrapper } = createConsoleQueryWrapper({ queryClient: client })
  const screen = await render(
    <Wrapper>
      <NuqsTestingAdapter>
        <I18nextProvider i18n={i18n}>
          <main aria-label="Deploy" className="isolate h-dvh min-w-0 overflow-hidden">
            <AppDeploy />
          </main>
        </I18nextProvider>
      </NuqsTestingAdapter>
    </Wrapper>,
  )
  await expect
    .element(screen.getByRole('region', { name: 'Environments', exact: true }))
    .toBeVisible()
  return { ...screen, queryClient: client }
}

export async function checkAccessibility(verifyFocusGuards?: (count: number) => Promise<void>) {
  await Promise.all(
    document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === 'running' &&
          Number.isFinite(animation.effect?.getComputedTiming().endTime),
      )
      .map((animation) => animation.finished.catch(() => undefined)),
  )
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
  const results = await axe.run(document.body, { runOnly: { type: 'tag', values: tags } })
  const verifiedNodes = new Set<axe.NodeResult>()
  if (verifyFocusGuards) {
    const guardNodes = results.violations
      .filter(({ id }) => id === 'aria-hidden-focus')
      .flatMap(({ nodes }) => nodes)
      .filter(({ target }) => {
        if (target.length !== 1 || typeof target[0] !== 'string') return false
        const element = document.querySelector(target[0])
        return (
          element?.matches('span[data-base-ui-focus-guard][aria-hidden="true"]') &&
          !element.childElementCount &&
          !element.textContent?.trim()
        )
      })
    expect(guardNodes.length).toBeGreaterThan(0)
    await verifyFocusGuards(guardNodes.length)
    // W3C ACT 6cfa84, Passed Example 4 permits sentinels that immediately redirect focus:
    // https://www.w3.org/WAI/standards-guidelines/act/rules/6cfa84/#passed-example-4
    // Keep every other aria-hidden-focus finding and every other axe rule in the assertion.
    for (const node of guardNodes) verifiedNodes.add(node)
  }
  expect(
    results.violations
      .map(({ id, helpUrl, nodes }) => ({
        id,
        helpUrl,
        nodes: nodes
          .filter((node) => !verifiedNodes.has(node))
          .map(({ target, failureSummary, html }) => ({ target, failureSummary, html })),
      }))
      .filter(({ nodes }) => nodes.length),
  ).toEqual([])
}

export async function checkMenuAccessibility(openMenu: () => Promise<void>) {
  await openMenu()
  await checkAccessibility(async (count) => {
    for (let index = 0; index < count; index++) {
      if (index > 0) {
        await userEvent.keyboard('{Escape}')
        await openMenu()
      }
      const guards = document.querySelectorAll<HTMLElement>(
        'span[data-base-ui-focus-guard][aria-hidden="true"]',
      )
      expect(guards.length).toBe(count)
      guards[index]!.focus()
      // Check after the next paint, before the ACT definition's one-second focusability limit.
      await new Promise(requestAnimationFrame)
      expect(document.activeElement?.matches('[data-base-ui-focus-guard]')).toBe(false)
      expect(document.activeElement).not.toBe(document.body)
      expect(document.activeElement?.closest('[aria-hidden="true"]')).toBeNull()
    }
  })
  await userEvent.keyboard('{Escape}')
}
