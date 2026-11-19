import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue } from 'jotai'
import { describe, expect, it, vi } from 'vite-plus/test'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import { formStateToAgentSoulConfig } from '@/features/agent-v2/agent-composer/conversions'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { consoleQuery } from '@/service/console'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createAgentPromptEnvironment } from '../../../__tests__/agent-prompt-editor-test-env'
import { AgentOrchestrateAddActionsProvider } from '../../add-actions'
import { AgentFiles } from '../../files'
import { AgentPromptEditor } from '../index'

type UploadInput = { body: { file: File } }
type CommitInput = { body: { upload_file_ids: string[] } }

const mocks = vi.hoisted(() => ({
  upload: vi.fn(async ({ body }: UploadInput) => ({ id: `upload-${body.file.name}` })),
  commit: vi.fn(async ({ body }: CommitInput) => ({
    files: body.upload_file_ids.map((id) => ({
      name: id.replace('upload-', ''),
      file_id: id,
      mime_type: 'text/markdown',
      size: 5,
    })),
  })),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')

  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'files.upload.post': (input: UploadInput) => mocks.upload(input),
      'agent.byAgentId.config.files.batch.post': (input: CommitInput) => mocks.commit(input),
    }),
  }
})

const menuName = /agentDetail\.configure\.prompt\.insert\.label/
const uploadTitle = /agentDetail\.configure\.files\.upload\.title/
const addFilesName = /agentDetail\.configure\.files\.add$/

function ConfigSnapshot() {
  const draft = useAtomValue(agentComposerDraftAtom)
  return (
    <output aria-label="config snapshot">
      {JSON.stringify(formStateToAgentSoulConfig({ formState: draft }))}
    </output>
  )
}

function renderPromptAndFiles() {
  const env = createAgentPromptEnvironment({ draft: { skills: [], tools: [], files: [] } })
  env.queryClient.setQueryData(
    consoleQuery.files.upload.get.queryKey(),
    createFileUploadConfigFixture(),
  )
  render(
    env.wrap(
      <AgentOrchestrateAddActionsProvider>
        <AgentPromptEditor />
        <AgentFiles />
        <ConfigSnapshot />
      </AgentOrchestrateAddActionsProvider>,
    ),
  )
}

async function openPromptFileUpload(user: ReturnType<typeof userEvent.setup>) {
  const editor = screen.getByRole('textbox')
  await user.click(editor)
  await replacePromptEditorText(editor, 'Review ')
  await user.keyboard('/')
  const menu = within(await screen.findByRole('dialog', { name: menuName }))
  await user.click(menu.getByRole('button', { name: /agentDetail\.configure\.files\.label/ }))
  await user.click(menu.getByRole('button', { name: addFilesName }))
  await screen.findByRole('dialog', { name: uploadTitle })
}

async function selectFiles(user: ReturnType<typeof userEvent.setup>, names: string[]) {
  const dialog = screen.getByRole('dialog', { name: uploadTitle })
  const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('Missing file input')
  await user.upload(
    input,
    names.map((name) => new File(['hello'], name, { type: 'text/markdown' })),
  )
}

async function clickUpload(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('button', { name: /agentDetail\.configure\.files\.upload\.action/ }),
  )
}

async function uploadFiles(user: ReturnType<typeof userEvent.setup>, names: string[]) {
  await selectFiles(user, names)
  await clickUpload(user)
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: uploadTitle })).not.toBeInTheDocument(),
  )
}

function configSnapshot() {
  return JSON.parse(screen.getByLabelText('config snapshot').textContent ?? '{}')
}

describe('Prompt file uploads', () => {
  it('keeps every uploaded file in the config and inserts all references in order', async () => {
    const user = userEvent.setup()
    renderPromptAndFiles()

    await openPromptFileUpload(user)
    await uploadFiles(user, ['first.md', 'second.md'])

    expect(mocks.commit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        body: { upload_file_ids: ['upload-first.md', 'upload-second.md'] },
      }),
    )
    const snapshot = configSnapshot()
    expect(snapshot.config_files).toEqual([
      expect.objectContaining({ name: 'first.md', file_id: 'upload-first.md' }),
      expect.objectContaining({ name: 'second.md', file_id: 'upload-second.md' }),
    ])
    expect(snapshot.prompt.system_prompt).toBe(
      'Review [§file:first.md:first.md§] [§file:second.md:second.md§] ',
    )
    const editor = within(screen.getByRole('textbox'))
    expect(editor.getByText('first.md')).toBeVisible()
    expect(editor.getByText('second.md')).toBeVisible()
  })

  it('inserts a retried file after a partial failure once the dialog closes', async () => {
    const user = userEvent.setup()
    mocks.upload.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderPromptAndFiles()

    await openPromptFileUpload(user)
    await selectFiles(user, ['retry.md', 'ready.md'])
    await clickUpload(user)
    await screen.findByText(/agentDetail\.configure\.files\.upload\.failed/)
    await clickUpload(user)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: uploadTitle })).not.toBeInTheDocument(),
    )

    expect(configSnapshot().prompt.system_prompt).toBe(
      'Review [§file:ready.md:ready.md§] [§file:retry.md:retry.md§] ',
    )
  })

  it('does not insert references after the Prompt session was cancelled', async () => {
    const user = userEvent.setup()
    renderPromptAndFiles()

    await openPromptFileUpload(user)
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: uploadTitle })).not.toBeInTheDocument(),
    )
    const prompt = configSnapshot().prompt.system_prompt

    await user.click(screen.getByRole('button', { name: addFilesName }))
    await screen.findByRole('dialog', { name: uploadTitle })
    await uploadFiles(user, ['unreferenced.md'])

    expect(configSnapshot().config_files).toEqual([
      expect.objectContaining({ name: 'unreferenced.md' }),
    ])
    expect(configSnapshot().prompt.system_prompt).toBe(prompt)
  })
})
