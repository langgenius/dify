import type { consoleClient } from '@/service/console'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { appWorkflowQueryOptions } from '@/service/workflow-queries'
import { createConsoleQueryWrapper, seedAppDetail } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { AppPublisher } from '../index'

// boundary: uses the real translation hooks with the publishing test's locale resources.
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return {
    ...actual,
    ...createReactI18nextMock({
      'workflow.common.workflowAsToolEndUserAuth':
        "Workflows with tools using App user authorization can't be published as tools.",
    }),
  }
})

it.each([false, true])(
  'blocks tool configuration for an App user authorized draft when toolPublished=%s and allows it after removing that authorization',
  async (toolPublished) => {
    const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
      workspacePermissionKeys: ['tool.manage'],
    })
    seedAppDetail(
      queryClient,
      createAppDetailFixture({
        id: 'app-1',
        mode: 'workflow',
        permission_keys: [],
      }),
    )
    // The published version has no App user tools; configuring republishes the current draft.
    queryClient.setQueryData(
      appWorkflowQueryOptions('app-1').queryKey,
      createWorkflowResponseFixture(),
    )
    const toolDetail: Awaited<
      ReturnType<typeof consoleClient.workspaces.current.toolProvider.workflow.get.get>
    > = {
      workflow_app_id: 'app-1',
      workflow_tool_id: 'tool-1',
      description: '',
      icon: { content: '🔧', background: '#ffffff' },
      label: 'Workflow tool',
      name: 'workflow_tool',
      parameters: [],
      synced: true,
      tool: {
        author: 'author',
        name: 'workflow_tool',
        label: { en_US: 'Workflow tool' },
        description: { en_US: '' },
        parameters: [],
      },
    }
    queryClient.setQueryData(
      consoleQuery.workspaces.current.toolProvider.workflow.get.get.queryKey({
        input: { query: { workflow_app_id: 'app-1' } },
      }),
      toolDetail,
    )
    const onPublish = vi.fn()
    const content = (hasEndUserAuthTools: boolean) => (
      <Providers>
        <AppPublisher
          appId="app-1"
          publishedAt={1_700_000_000_000}
          hasEndUserAuthTools={hasEndUserAuthTools}
          toolPublished={toolPublished}
          onPublish={onPublish}
        />
      </Providers>
    )
    const screen = await render(content(true))
    await screen.getByRole('button', { name: 'workflow.common.publish' }).click()
    const actionName = toolPublished
      ? 'workflow.common.configure'
      : 'navigation.common.workflowAsTool'
    const action = screen.getByRole('button', { name: actionName })
    const reason = "Workflows with tools using App user authorization can't be published as tools."

    await expect.element(action).toHaveAttribute('aria-disabled', 'true')
    await expect.element(action).toHaveAccessibleDescription(reason)
    await expect.element(screen.getByText(reason)).not.toBeInTheDocument()
    await action.hover()
    await expect.element(screen.getByRole('tooltip')).toHaveTextContent(reason)
    for (let tabs = 0; tabs < 8 && document.activeElement !== action.element(); tabs++)
      await userEvent.tab()
    await expect.element(action).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    await expect
      .element(screen.getByRole('dialog', { name: 'navigation.common.workflowAsTool' }))
      .not.toBeInTheDocument()
    expect(onPublish).not.toHaveBeenCalled()
    if (toolPublished)
      await expect
        .element(screen.getByRole('link', { name: 'workflow.common.manageInTools' }))
        .not.toBeInTheDocument()

    await screen.rerender(content(false))
    await expect.element(action).not.toHaveAttribute('aria-disabled', 'true')
    await action.click()
    await expect
      .element(screen.getByRole('dialog', { name: 'navigation.common.workflowAsTool' }))
      .toBeVisible()
    expect(onPublish).not.toHaveBeenCalled()
  },
)
