import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
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
type CommitInput = { body: { upload_file_id: string } }

const mocks = vi.hoisted(() => ({
  upload: vi.fn(async ({ body }: UploadInput) => ({ id: `upload-${body.file.name}` })),
  commit: vi.fn(async ({ body }: CommitInput) => ({
    file: {
      name: body.upload_file_id.replace('upload-', ''),
      file_id: body.upload_file_id,
      mime_type: 'text/markdown',
      size: 5,
    },
  })),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')

  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'files.upload.post': mocks.upload,
      'agent.byAgentId.config.files.post': mocks.commit,
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

async function uploadFiles(user: ReturnType<typeof userEvent.setup>, names: string[]) {
  const input = screen.getByLabelText(/agentDetail\.configure\.files\.upload\.browse/, {
    selector: 'input',
  }) as HTMLInputElement
  await user.upload(
    input,
    names.map((name) => new File(['hello'], name, { type: 'text/markdown' })),
  )
  await user.click(
    screen.getByRole('button', { name: /agentDetail\.configure\.files\.upload\.action/ }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: uploadTitle })).not.toBeInTheDocument(),
  )
}

function configSnapshot() {
  return JSON.parse(screen.getByLabelText('config snapshot').textContent ?? '{}')
}

describe('Prompt file uploads', () => {
  beforeEach(() => {
    mocks.upload.mockClear()
    mocks.commit.mockClear()
  })

  it('keeps every successfully uploaded file in the config and inserts all references in order', async () => {
    const user = userEvent.setup()
    renderPromptAndFiles()

    await openPromptFileUpload(user)
    await uploadFiles(user, ['first.md', 'second.md'])

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

  it('ends the Prompt insertion session when the upload dialog closes', async () => {
    const user = userEvent.setup()
    renderPromptAndFiles()

    await openPromptFileUpload(user)
    await uploadFiles(user, ['referenced.md'])
    const prompt = configSnapshot().prompt.system_prompt

    await user.click(screen.getByRole('button', { name: addFilesName }))
    await screen.findByRole('dialog', { name: uploadTitle })
    await uploadFiles(user, ['unreferenced.md'])

    expect(configSnapshot().config_files).toEqual([
      expect.objectContaining({ name: 'referenced.md' }),
      expect.objectContaining({ name: 'unreferenced.md' }),
    ])
    expect(configSnapshot().prompt.system_prompt).toBe(prompt)
    expect(
      within(screen.getByRole('textbox')).queryByText('unreferenced.md'),
    ).not.toBeInTheDocument()
  })
})
