import type { ComponentProps } from 'react'
import { zWorkflowToolDetailResponse } from '@dify/contracts/api/console/workspaces/zod.gen'
import { render } from 'vitest-browser-react'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { InputVarType } from '@/app/components/workflow/types'
import { AppToaster } from '@/app/notifications/app-toaster'
import { TEST_APP_ID } from '@/test/console/ids'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { hold, setupFakeApi } from '@/test/fake-api'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { createTestNavigation } from '@/test/next-navigation'
import { AppPublisher } from '../index'

const detail = zWorkflowToolDetailResponse.parse({
  workflow_app_id: TEST_APP_ID,
  workflow_tool_id: '019a0000-0000-7000-8000-000000000002',
  name: 'lookup',
  label: 'Lookup',
  description: 'Look up an order',
  icon: { content: '🔧', background: '#ffffff' },
  parameters: [{ name: 'query', description: 'Order number', form: 'llm' }],
  synced: true,
  tool: {
    name: 'lookup',
    author: 'Dify',
    label: { en_US: 'Lookup' },
    description: { en_US: 'Look up an order' },
    parameters: [
      { name: 'query', type: 'string', required: true, form: 'llm', label: { en_US: 'Query' } },
    ],
  },
})

const fake = setupFakeApi({
  console: {
    apps: {
      byAppId: {
        get: () => createAppDetailFixture({ mode: 'workflow', permission_keys: [] }),
        workflows: { publish: { get: () => createWorkflowResponseFixture() } },
      },
    },
    workspaces: { current: { toolProvider: { workflow: { get: { get: () => detail } } } } },
  },
})

async function renderPublisher(props: Partial<ComponentProps<typeof AppPublisher>> = {}) {
  const { wrapper: Wrapper } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['tool.manage'],
  })
  const { NavigationProvider } = createTestNavigation({
    url: `/app/${TEST_APP_ID}/workflow`,
    params: { appId: TEST_APP_ID },
  })
  const screen = await render(
    <Wrapper>
      <NavigationProvider>
        <WorkflowContext value={createWorkflowStore({})}>
          <AppPublisher
            appId={TEST_APP_ID}
            toolPublished
            inputs={[
              { variable: 'query', label: 'Query', type: InputVarType.textInput, required: true },
            ]}
            {...props}
          />
        </WorkflowContext>
      </NavigationProvider>
      <AppToaster />
    </Wrapper>,
  )
  await screen.getByRole('button', { name: 'workflow.common.publish' }).click()
  return screen
}

it('shows a pending tool version even when the input parameters have not changed', async () => {
  fake.console.workspaces.current.toolProvider.workflow.get.get.mockReturnValue({
    ...detail,
    synced: false,
  })
  const screen = await renderPublisher()

  await expect
    .element(screen.getByRole('status', { name: 'workflow.common.workflowAsToolVersionOutdated' }))
    .toBeVisible()
  await expect
    .element(screen.getByText('workflow.common.workflowAsToolVersionOutdatedTip'))
    .toBeVisible()
  await expect
    .element(screen.getByRole('status', { name: 'workflow.common.workflowAsToolReady' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'workflow.common.workflowAsToolReconfigure' }))
    .toBeEnabled()
})

it('waits for the tool detail before showing its current version state', async () => {
  const pending = hold(fake.console.workspaces.current.toolProvider.workflow.get.get)
  const screen = await renderPublisher()
  await pending.arrived
  await expect.element(screen.getByRole('status', { name: 'appApi.loading' })).toBeVisible()
  await expect
    .element(screen.getByRole('status', { name: 'workflow.common.workflowAsToolReady' }))
    .not.toBeInTheDocument()
  pending.resolve(detail)
  await expect
    .element(screen.getByRole('status', { name: 'workflow.common.workflowAsToolReady' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('status', { name: 'workflow.common.workflowAsToolVersionOutdated' }))
    .not.toBeInTheDocument()
})

it('refreshes the tool version after publishing without silently updating the tool', async () => {
  const getDetail = fake.console.workspaces.current.toolProvider.workflow.get.get
  getDetail.mockReturnValue(detail)
  const onPublish = vi.fn(async () => {
    getDetail.mockReturnValue({ ...detail, synced: false })
  })
  const screen = await renderPublisher({ onPublish })
  await expect
    .element(screen.getByRole('status', { name: 'workflow.common.workflowAsToolReady' }))
    .toBeVisible()

  await screen.getByRole('button', { name: 'workflow.common.publishUpdate' }).click()

  await expect
    .element(screen.getByRole('status', { name: 'workflow.common.workflowAsToolVersionOutdated' }))
    .toBeVisible()
  expect(onPublish).toHaveBeenCalledTimes(1)
  expect(getDetail).toHaveBeenCalledTimes(2)
  // There is deliberately no update handler in the fake API: publication must not sync the tool.
})

it('keeps parameter changes distinct from a pending tool version', async () => {
  fake.console.workspaces.current.toolProvider.workflow.get.get.mockReturnValue({
    ...detail,
    synced: false,
  })
  const screen = await renderPublisher({
    inputs: [{ variable: 'query', label: 'Query', type: InputVarType.textInput, required: false }],
  })

  await expect
    .element(screen.getByRole('status', { name: 'workflow.common.workflowAsToolUpdateNeeded' }))
    .toBeVisible()
  await expect.element(screen.getByText('workflow.common.workflowAsToolTip')).toBeVisible()
  await expect
    .element(screen.getByRole('status', { name: 'workflow.common.workflowAsToolVersionOutdated' }))
    .not.toBeInTheDocument()
})

it('clears the pending version only after an explicit confirmed tool update', async () => {
  const getDetail = fake.console.workspaces.current.toolProvider.workflow.get.get
  getDetail.mockReturnValue({ ...detail, synced: false })
  const update = vi.fn(() => {
    getDetail.mockReturnValue(detail)
    return { result: 'success' }
  })
  fake.use({
    console: {
      workspaces: { current: { toolProvider: { workflow: { update: { post: update } } } } },
    },
  })
  const onPublish = vi.fn(async () => {})
  const screen = await renderPublisher({ onPublish })
  await screen.getByRole('button', { name: 'workflow.common.workflowAsToolReconfigure' }).click()
  const drawer = screen.getByRole('dialog', { name: 'navigation.common.workflowAsTool' })
  await expect.element(drawer).toBeVisible()
  await drawer.getByRole('button', { name: 'common.operation.save' }).click()
  const confirmation = screen.getByRole('dialog', { name: 'tools.createTool.confirmTitle' })
  await expect.element(confirmation).toBeVisible()
  expect(update).not.toHaveBeenCalled()
  await confirmation.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.element(drawer).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'workflow.common.publish' }).click()
  await expect
    .element(screen.getByRole('status', { name: 'workflow.common.workflowAsToolReady' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('status', { name: 'workflow.common.workflowAsToolVersionOutdated' }))
    .not.toBeInTheDocument()
  expect(update).toHaveBeenCalledTimes(1)
  expect(onPublish).toHaveBeenCalledTimes(1)
})
