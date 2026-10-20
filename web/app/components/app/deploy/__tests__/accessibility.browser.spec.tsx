import type {
  EnvironmentDeployment,
  GetWorkflowDeploymentOptionsResponse,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import {
  DeploymentOperationStatus,
  DeploymentOperationType,
  EnvironmentStatus,
  EnvVarValueType,
  PluginCategory,
  RuntimeState,
} from '@dify/contracts/enterprise-app-deploy/types.gen'
import axe from 'axe-core'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
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

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'deploy-audit' }),
}))

vi.mock('react-i18next', (importOriginal) => importOriginal())

const appId = 'deploy-audit'
const environment = {
  id: 'canary',
  display_name: 'Canary',
  description: '',
  status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
}
const deployment: EnvironmentDeployment = {
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

async function renderDeploy({
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

async function checkAccessibility(verifyFocusGuards?: (count: number) => Promise<void>) {
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

async function checkMenuAccessibility(openMenu: () => Promise<void>) {
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

it('verifies every reported menu sentinel redirects focus and allows keyboard exit in both directions', async () => {
  const screen = await renderDeploy()
  const trigger = screen.getByRole('button', { name: 'Deploy', exact: true })
  const openDeployMenu = async () => {
    trigger.element().focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(screen.getByRole('menuitem', { name: 'Dev', exact: true })).toHaveFocus()
  }
  await checkMenuAccessibility(openDeployMenu)
  await openDeployMenu()
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(trigger).toHaveFocus()
  await openDeployMenu()
  await userEvent.keyboard('{Tab}')
  await expect.element(screen.getByRole('button', { name: 'Release 0', exact: true })).toHaveFocus()

  const more = screen.getByRole('button', { name: 'Canary · More actions', exact: true })
  await checkMenuAccessibility(async () => {
    more.element().focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(screen.getByRole('menu')).toBeVisible()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('keeps focus through the first lazy menu handoff and resets deployment drafts before a pointer reopen', async () => {
  const screen = await renderDeploy()
  await checkAccessibility()
  const trigger = screen.getByRole('button', { name: 'Deploy', exact: true })
  trigger.element().focus()
  await userEvent.keyboard('{Enter}')
  const dev = screen.getByRole('menuitem', { name: 'Dev', exact: true })
  await expect.element(dev).toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(dev).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Release 0', exact: true })).toHaveFocus()
  trigger.element().focus()
  await userEvent.keyboard('{Enter}')
  await expect.element(dev).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const versions = screen.getByRole('dialog', { name: 'Deploy to Dev', exact: true })
  await expect.element(dev).not.toBeInTheDocument()
  await expect
    .element(versions.getByRole('heading', { name: 'Deploy to Dev', exact: true }))
    .toHaveFocus()
  await checkAccessibility()
  await versions.getByRole('button', { name: /Release 1/ }).click()
  const configuration = screen.getByRole('dialog', { name: 'Deploy configuration', exact: true })
  await expect
    .element(configuration.getByRole('heading', { name: 'Deploy configuration', exact: true }))
    .toHaveFocus()
  await checkAccessibility()

  await configuration.getByRole('button', { name: 'Deploy', exact: true }).click()
  const credential = configuration.getByRole('combobox', { name: 'Deepseek', exact: true })
  await expect.element(credential).toHaveFocus()
  await expect.element(credential).toHaveAttribute('aria-invalid', 'true')
  await checkAccessibility()
  await credential.click()
  await screen.getByRole('option', { name: 'Production key', exact: true }).click()
  await configuration.getByRole('button', { name: 'Deploy', exact: true }).click()
  const port = configuration.getByRole('spinbutton', { name: 'PORT', exact: true })
  await expect.element(port).toHaveFocus()
  await expect.element(port).toHaveAttribute('aria-invalid', 'true')
  await checkAccessibility()
  await port.fill('3000')
  await userEvent.keyboard('{Escape}')
  await expect.element(configuration).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()

  await trigger.click()
  await dev.click()
  await expect.element(dev).not.toBeInTheDocument()
  await expect
    .element(versions.getByRole('heading', { name: 'Deploy to Dev', exact: true }))
    .toHaveFocus()
  await versions.getByRole('button', { name: /Release 1/ }).click()
  await expect.element(credential).toBeVisible()
  await expect.element(port).toHaveValue(null)
  await configuration.getByRole('button', { name: 'Deploy', exact: true }).click()
  await expect.element(credential).toHaveAttribute('aria-invalid', 'true')
  await expect.element(credential).toHaveFocus()
  await configuration.getByRole('button', { name: 'Back', exact: true }).click()
  await expect
    .element(versions.getByRole('heading', { name: 'Deploy to Dev', exact: true }))
    .toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(versions).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})

it('uses the requested version and restores surviving triggers as redeploy and undeploy menu items unmount', async () => {
  const screen = await renderDeploy()
  const latest = screen.getByRole('button', { name: 'Deploy latest', exact: true })
  await latest.click()
  const configuration = screen.getByRole('dialog', { name: 'Deploy configuration', exact: true })
  await expect.element(configuration.getByText('Release 1', { exact: true })).toBeVisible()
  await configuration.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(configuration).not.toBeInTheDocument()
  await expect.element(latest).toHaveFocus()
  const more = screen.getByRole('button', { name: 'Canary · More actions', exact: true })
  await more.click()
  const redeploy = screen.getByRole('menuitem', { name: 'Redeploy', exact: true })
  await redeploy.click()
  await expect.element(configuration).toBeVisible()
  await expect.element(configuration.getByText('Release 0', { exact: true })).toBeVisible()
  await expect.element(redeploy).not.toBeInTheDocument()
  await expect
    .element(configuration.getByRole('heading', { name: 'Deploy configuration', exact: true }))
    .toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(configuration).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'Undeploy', exact: true }))
    .toBeVisible()
  await userEvent.keyboard('{End}')
  const undeploy = screen.getByRole('menuitem', { name: 'Undeploy', exact: true })
  await expect.element(undeploy).toHaveFocus()
  await userEvent.keyboard(' ')
  const confirmation = screen.getByRole('alertdialog')
  await expect.element(confirmation).toBeVisible()
  await expect.element(undeploy).not.toBeInTheDocument()
  await checkAccessibility()
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(confirmation).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
  await more.click()
  await undeploy.click()
  await expect.element(confirmation).toBeVisible()
  await expect.element(undeploy).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(confirmation).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
})

it('keeps disabled composed menu triggers inert and opens the current environment after deployment finishes', async () => {
  const deploying: EnvironmentDeployment = {
    ...deployment,
    deployment: {
      runtimeState: RuntimeState.RUNTIME_STATE_STARTING,
    },
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    if (request.url.endsWith('/environments'))
      return Response.json({ data: [{ ...environment, in_use: true }] })
    if (request.url.endsWith('/workflows/environment-deployments'))
      return Response.json({ environment_deployments: [deploying] })
    throw new Error(`Unexpected request: ${request.method} ${request.url}`)
  })
  const screen = await renderDeploy({ environmentDeployments: [deploying] })
  const more = screen.getByRole('button', { name: 'Canary · More actions', exact: true })
  more.element().focus()
  await userEvent.keyboard('{Enter}')
  const changeVersion = screen.getByRole('menuitem', { name: 'Change version', exact: true })
  await expect.element(changeVersion).toHaveAttribute('aria-disabled', 'true')
  changeVersion.element().focus()
  await expect.element(changeVersion).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await userEvent.keyboard(' ')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(more).toHaveFocus()

  screen.queryClient.setQueryData(
    consoleQuery.enterprise.appDeploy.deploymentService.listEnvironmentDeployments.queryKey({
      input: { params: { app_id: appId } },
    }),
    { environment_deployments: [deployment] },
  )
  await userEvent.keyboard('{Enter}')
  await expect.element(changeVersion).not.toHaveAttribute('aria-disabled', 'true')
  await expect.element(changeVersion).toHaveFocus()
  await userEvent.keyboard(' ')
  const versions = screen.getByRole('dialog', { name: 'Change version · Canary', exact: true })
  await expect.element(changeVersion).not.toBeInTheDocument()
  await expect
    .element(versions.getByRole('heading', { name: 'Change version · Canary', exact: true }))
    .toHaveFocus()
  await versions.getByRole('button', { name: /Release 1/ }).click()
  const configuration = screen.getByRole('dialog', { name: 'Deploy configuration', exact: true })
  await expect.element(configuration).toBeVisible()
  await configuration.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(configuration).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
})

it('returns focus to the environment heading after a successful deployment removes the empty-state trigger', async () => {
  const deployed: EnvironmentDeployment = {
    ...deployment,
    environment: { ...environment, id: 'dev', display_name: 'Dev' },
  }
  const deployRequests: Request[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    if (request.url.endsWith('/deployment:deploy')) {
      deployRequests.push(request.clone())
      return Response.json({
        operation: {
          id: 'deploy-dev',
          status: DeploymentOperationStatus.DEPLOYMENT_OPERATION_STATUS_SUCCEEDED,
          type: DeploymentOperationType.DEPLOYMENT_OPERATION_TYPE_DEPLOY,
        },
      })
    }
    if (request.url.endsWith('/environments'))
      return Response.json({ data: [{ ...deployed.environment, in_use: true }] })
    if (request.url.endsWith('/workflows/environment-deployments'))
      return Response.json({ environment_deployments: [deployed] })
    throw new Error(`Unexpected request: ${request.method} ${request.url}`)
  })
  const screen = await renderDeploy({ environmentDeployments: [] })
  const emptyDeploy = screen.getByRole('button', { name: 'Deploy', exact: true }).nth(1)
  await emptyDeploy.click()
  await screen.getByRole('menuitem', { name: 'Dev', exact: true }).click()
  const versions = screen.getByRole('dialog', { name: 'Deploy to Dev', exact: true })
  await versions.getByRole('button', { name: /Release 1/ }).click()
  const configuration = screen.getByRole('dialog', { name: 'Deploy configuration', exact: true })
  await configuration.getByRole('combobox', { name: 'Deepseek', exact: true }).click()
  await screen.getByRole('option', { name: 'Production key', exact: true }).click()
  await configuration.getByRole('spinbutton', { name: 'PORT', exact: true }).fill('3000')
  await configuration.getByRole('button', { name: 'Deploy', exact: true }).click()
  await expect.element(configuration).not.toBeInTheDocument()
  await expect.element(screen.getByRole('rowheader', { name: 'Dev', exact: true })).toBeVisible()
  await expect
    .element(screen.getByRole('heading', { name: 'Environments', exact: true }))
    .toHaveFocus()
  expect(deployRequests).toHaveLength(1)
  expect(new URL(deployRequests[0]!.url).pathname).toContain('/environments/dev/deployment:deploy')
})

it('audits the LLM model picker and settings reachable from deploy without mounting workflow editors or media', async () => {
  const screen = await renderDeploy({ withLLM: true })
  await screen.getByRole('button', { name: 'Deploy', exact: true }).click()
  await screen.getByRole('menuitem', { name: 'Dev', exact: true }).click()
  const versions = screen.getByRole('dialog', { name: 'Deploy to Dev', exact: true })
  await expect
    .element(versions.getByRole('heading', { name: 'Deploy to Dev', exact: true }))
    .toHaveFocus()
  await versions.getByRole('button', { name: /Release 1/ }).click()
  const configuration = screen.getByRole('dialog', { name: 'Deploy configuration', exact: true })
  await expect.element(configuration.getByRole('button', { name: /^Chat model/ })).toBeDisabled()
  await configuration.getByRole('combobox', { name: /MODEL/ }).click()
  await screen.getByRole('option', { name: 'Custom value', exact: true }).click()
  await configuration.getByRole('button', { name: 'Configure model', exact: true }).click()
  const modelPicker = screen.getByRole('dialog', { name: 'Configure model', exact: true })
  await expect
    .element(modelPicker.getByRole('button', { name: 'Chat model', exact: true }))
    .toBeVisible()
  await checkAccessibility()
  await modelPicker.getByRole('button', { name: 'Chat model', exact: true }).click()
  await configuration.getByRole('button', { name: 'Model Settings', exact: true }).click()
  const settings = screen.getByRole('dialog', { name: 'Model Settings', exact: true })
  await expect
    .element(settings.getByRole('textbox', { name: 'System instruction', exact: true }))
    .toBeVisible()
  await checkAccessibility()
  expect(document.querySelector('audio, video, [contenteditable="true"]')).toBeNull()
  await userEvent.keyboard('{Escape}')
  await expect.element(settings).not.toBeInTheDocument()
  await expect
    .element(configuration.getByRole('button', { name: 'Model Settings', exact: true }))
    .toHaveFocus()
})

it('opens the workflow source disclosure from the keyboard and restores focus within configuration', async () => {
  const screen = await renderDeploy()
  await screen.getByRole('button', { name: 'Deploy', exact: true }).click()
  await screen.getByRole('menuitem', { name: 'Dev', exact: true }).click()
  const versions = screen.getByRole('dialog', { name: 'Deploy to Dev', exact: true })
  await expect
    .element(versions.getByRole('heading', { name: 'Deploy to Dev', exact: true }))
    .toHaveFocus()
  await versions.getByRole('button', { name: /Release 1/ }).click()
  const configuration = screen.getByRole('dialog', { name: 'Deploy configuration', exact: true })
  const source = configuration.getByRole('button', { name: /Deepseek.*Customer support workflow/ })
  await expect.element(source).toBeVisible()
  source.element().focus()
  await userEvent.keyboard('{Enter}')
  const disclosure = screen.getByRole('dialog', { name: 'Deepseek', exact: true })
  await expect
    .element(disclosure.getByRole('link', { name: 'Customer support workflow', exact: true }))
    .toHaveAttribute('href', '/app/source-workflow/workflow')
  await checkAccessibility()
  await userEvent.keyboard('{Escape}')
  await expect.element(disclosure).not.toBeInTheDocument()
  await expect.element(source).toHaveFocus()
  await expect.element(configuration).toBeVisible()
})

it('reflows the built-in card at 320px and keeps table actions reachable in a short viewport', async () => {
  await page.viewport(320, 256)
  const screen = await renderDeploy()
  const main = screen.getByRole('main', { name: 'Deploy', exact: true })
  const builtIn = screen.getByRole('region', { name: 'Built-in Environment', exact: true })
  await expect.element(builtIn).toBeVisible()
  expect(main.element().scrollWidth).toBeLessThanOrEqual(320)
  const more = screen.getByRole('button', { name: 'Canary · More actions', exact: true })
  more.element().focus()
  await expect.element(more).toHaveFocus()
  const bounds = more.element().getBoundingClientRect()
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(320)
  expect(bounds.top).toBeGreaterThanOrEqual(0)
  expect(bounds.bottom).toBeLessThanOrEqual(256)
  await userEvent.keyboard('{Enter}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'Redeploy', exact: true }))
    .toBeVisible()
  await screen.getByRole('menuitem', { name: 'Redeploy', exact: true }).click()
  const configuration = screen.getByRole('dialog', { name: 'Deploy configuration', exact: true })
  const cancel = configuration.getByRole('button', { name: 'Cancel', exact: true })
  await expect.element(cancel).toBeVisible()
  cancel.element().focus()
  await expect.element(cancel).toHaveFocus()
  const cancelBounds = cancel.element().getBoundingClientRect()
  expect(cancelBounds.left).toBeGreaterThanOrEqual(0)
  expect(cancelBounds.right).toBeLessThanOrEqual(320)
  expect(cancelBounds.top).toBeGreaterThanOrEqual(0)
  expect(cancelBounds.bottom).toBeLessThanOrEqual(256)
  await userEvent.keyboard('{Enter}')
  await expect.element(configuration).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
})

it('keeps focused configuration fields and actions fully visible in a short viewport', async () => {
  await page.viewport(320, 240)
  const screen = await renderDeploy()
  await screen.getByRole('button', { name: 'Deploy latest', exact: true }).click()
  const configuration = screen.getByRole('dialog', { name: 'Deploy configuration', exact: true })
  await expect
    .element(configuration.getByRole('heading', { name: 'Deploy configuration', exact: true }))
    .toHaveFocus()

  const controls = [
    configuration.getByRole('button', { name: /Deepseek.*Customer support workflow/ }),
    configuration.getByRole('combobox', { name: 'Deepseek', exact: true }),
    configuration.getByRole('combobox', { name: /PORT/ }),
    configuration.getByRole('spinbutton', { name: 'PORT', exact: true }),
    configuration.getByRole('button', { name: 'Cancel', exact: true }),
  ]

  for (const control of controls) {
    await userEvent.keyboard('{Tab}')
    await expect.element(control).toHaveFocus()
    const element = control.element()
    const bounds = element.getBoundingClientRect()
    let visibleTop = 0
    let visibleBottom = window.innerHeight

    // A focusable field can pass visibility checks while its scroll area clips the whole field.
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (!['auto', 'hidden', 'scroll', 'clip'].includes(getComputedStyle(parent).overflowY))
        continue
      const parentBounds = parent.getBoundingClientRect()
      visibleTop = Math.max(visibleTop, parentBounds.top + parent.clientTop)
      visibleBottom = Math.min(
        visibleBottom,
        parentBounds.top + parent.clientTop + parent.clientHeight,
      )
    }

    expect(bounds.height).toBeGreaterThan(0)
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth)
    expect(bounds.top).toBeGreaterThanOrEqual(visibleTop)
    expect(bounds.bottom).toBeLessThanOrEqual(visibleBottom)
  }
})

it('keeps deployment status and version text readable in dark mode', async () => {
  document.documentElement.dataset.theme = 'dark'
  try {
    await renderDeploy()
    await checkAccessibility()
  } finally {
    document.documentElement.dataset.theme = 'light'
  }
})
