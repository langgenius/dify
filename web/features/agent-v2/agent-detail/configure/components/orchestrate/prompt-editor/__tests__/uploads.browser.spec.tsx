import { expect, it, vi } from 'vite-plus/test'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { consoleQuery } from '@/service/console'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createAgentPromptEnvironment } from '../../../__tests__/agent-prompt-editor-test-env'
import { AgentOrchestrateAddActionsProvider } from '../../add-actions'
import { AgentFiles } from '../../files'
import { AgentPromptEditor } from '../index'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')

  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'files.upload.post': async ({ body }: { body: { file: File } }) => ({ id: body.file.name }),
      'agent.byAgentId.config.files.post': async ({
        body,
      }: {
        body: { upload_file_id: string }
      }) => ({
        file: {
          name: body.upload_file_id,
          file_id: body.upload_file_id,
          mime_type: 'text/markdown',
          size: 5,
        },
      }),
    }),
  }
})

it('inserts every uploaded reference at the native slash caret before the remaining Prompt', async () => {
  // Unit tests prove batch persistence; native caret and focus across the upload dialog must preserve insertion order before a suffix.
  const { wrap, store, queryClient } = createAgentPromptEnvironment({
    draft: { skills: [], tools: [], files: [] },
  })
  queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  const screen = await render(
    wrap(
      <AgentOrchestrateAddActionsProvider>
        <AgentPromptEditor />
        <AgentFiles />
      </AgentOrchestrateAddActionsProvider>,
    ),
  )
  const editor = screen.getByRole('textbox')
  await editor.fill('Review / now')
  await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}')
  const menu = screen.getByRole('dialog', { name: /agentDetail\.configure\.prompt\.insert\.label/ })
  await expect.element(menu).toBeVisible()
  await menu.getByRole('button', { name: /agentDetail\.configure\.files\.label/ }).click()
  await menu.getByRole('button', { name: /agentDetail\.configure\.files\.add$/ }).click()
  const uploadDialog = screen.getByRole('dialog', {
    name: /agentDetail\.configure\.files\.upload\.title/,
  })
  await expect.element(uploadDialog).toBeVisible()
  await uploadDialog
    .getByLabelText(/agentDetail\.configure\.files\.upload\.browse/)
    .upload([
      new File(['hello'], 'first.md', { type: 'text/markdown' }),
      new File(['hello'], 'second.md', { type: 'text/markdown' }),
    ])
  await uploadDialog
    .getByRole('button', { name: /agentDetail\.configure\.files\.upload\.action/ })
    .click()
  await expect.element(uploadDialog).not.toBeInTheDocument()
  await expect
    .poll(() => store.get(agentComposerPromptAtom))
    .toBe('Review [§file:first.md:first.md§] [§file:second.md:second.md§] now')
  queryClient.clear()
})
