import type { ChatItem } from '../../../types'
import type { FileResponse } from '@/types/workflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { addFileInfos } from '@/app/components/tools/utils'
import {
  createChatAnnotationFixture,
  createChatFileFixture,
  createChatThoughtFixture as thought,
} from '@/test/fixtures/chat'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { TransferMethod } from '@/types/app'
import { renderChat } from '../../__tests__/chat-browser-test-env'
import AgentContent from '../agent-content'

vi.unmock('react-i18next')

beforeEach(async () => {
  await page.viewport(900, 700)
  onTestFinished(guardUnexpectedFetch())
})

const item: ChatItem = { id: 'answer', content: '', isAnswer: true }

it('replaces superseded thoughts with the final response, then displays its saved annotation', async () => {
  const answer = { ...item, agent_thoughts: [thought({ thought: 'Superseded thought' })] }
  const screen = await renderChat(<AgentContent item={answer} content="Final response" />)
  await expect.element(screen.getByText('Final response')).toBeVisible()
  await expect.element(screen.getByText('Superseded thought')).not.toBeInTheDocument()
  await screen.rerender(
    <AgentContent
      item={{ ...answer, annotation: createChatAnnotationFixture('Edited response') }}
      content="Final response"
    />,
  )
  await expect.element(screen.getByText('Edited response')).toBeVisible()
  await expect.element(screen.getByText('Final response')).not.toBeInTheDocument()
})

it('keeps streamed tool results readable and focused as the response completes', async () => {
  const answer: ChatItem = {
    ...item,
    agent_thoughts: [
      thought({ thought: 'Search documents', tool: 'search', observation: 'Found a document' }),
      thought({ id: 'thought-2', thought: 'Fetch details', tool: 'fetch', position: 1 }),
    ],
  }
  const screen = await renderChat(
    <>
      <button>Before response</button>
      <AgentContent item={answer} responding />
    </>,
  )
  await expect.element(screen.getByText('Search documents')).toBeVisible()
  await expect.element(screen.getByText('Fetch details')).toBeVisible()
  await screen.getByRole('button', { name: 'Before response' }).click()
  await userEvent.tab()
  const search = screen.getByRole('button', { name: 'Used search' })
  await expect.element(search).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('Found a document')).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Using fetch' })).toBeVisible()
  await screen.rerender(
    <>
      <button>Before response</button>
      <AgentContent item={answer} responding={false} />
    </>,
  )
  await expect.element(screen.getByRole('button', { name: 'Used fetch' })).toBeVisible()
  await expect.element(screen.getByText('Found a document')).toBeVisible()
  await expect.element(search).toHaveFocus()
})

function captureDownloads() {
  const downloads: { url: string; filename: string }[] = []
  const capture = (event: MouseEvent) => {
    if (!(event.target instanceof HTMLAnchorElement) || !event.target.download) return
    event.preventDefault()
    downloads.push({ url: event.target.href, filename: event.target.download })
  }
  document.addEventListener('click', capture, true)
  onTestFinished(() => document.removeEventListener('click', capture, true))
  return downloads
}

it('keeps normalized streaming attachment names paired with their actual download destinations', async () => {
  const downloads = captureDownloads()
  const screen = await renderChat(
    <AgentContent
      item={{
        ...item,
        agent_thoughts: [
          thought({
            message_files: [
              createChatFileFixture({
                name: 'report.pdf',
                type: 'application/pdf',
                url: 'https://example.com/report.pdf',
              }),
              createChatFileFixture({
                id: 'file-2',
                name: 'notes.txt',
                url: 'https://example.com/notes.txt',
              }),
            ],
          }),
        ],
      }}
    />,
  )
  await expect
    .element(screen.getByRole('button', { name: 'report.pdf', exact: true }))
    .toBeVisible()
  await expect.element(screen.getByText('notes.txt', { exact: true })).toBeVisible()
  const actions = screen.getByRole('button', { name: 'Download', exact: true })
  await screen.getByText('report.pdf', { exact: true }).hover()
  await actions.click()
  await screen.getByText('notes.txt', { exact: true }).hover()
  await actions.click()
  expect(downloads).toEqual([
    { url: 'https://example.com/report.pdf?as_attachment=true', filename: 'report.pdf' },
    { url: 'https://example.com/notes.txt?as_attachment=true', filename: 'notes.txt' },
  ])
})

it('resolves historical thought file ids to an operable attachment download', async () => {
  const downloads = captureDownloads()
  const file = {
    id: 'history-file',
    related_id: 'history-file',
    filename: 'history.pdf',
    extension: 'pdf',
    mime_type: 'application/pdf',
    type: 'document',
    size: 100,
    transfer_method: TransferMethod.local_file,
    upload_file_id: 'uploaded-file',
    url: 'https://example.com/history.pdf',
    remote_url: '',
  } satisfies FileResponse & { id: string }
  const thoughts = addFileInfos([thought({ files: [file.id] })], [file])
  const screen = await renderChat(<AgentContent item={{ ...item, agent_thoughts: thoughts }} />)
  await expect.element(screen.getByRole('button', { name: 'history.pdf' })).toBeVisible()
  await screen.getByText('history.pdf', { exact: true }).hover()
  await screen.getByRole('button', { name: 'Download', exact: true }).click()
  expect(downloads).toEqual([
    { url: 'https://example.com/history.pdf?as_attachment=true', filename: 'history.pdf' },
  ])
})
