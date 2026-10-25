import type { ChatItem } from '../../../types'
import type { FileResponse } from '@/types/workflow'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addFileInfos } from '@/app/components/tools/utils'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import {
  createChatAnnotationFixture,
  createChatFileFixture,
  createChatThoughtFixture as thought,
} from '@/test/fixtures/chat'
import { TransferMethod } from '@/types/app'
import AgentContent from '../agent-content'

const item: ChatItem = { id: 'answer', content: '', isAnswer: true }

it('shows saved annotation content instead of the original response', async () => {
  render(
    <AgentContent
      item={{ ...item, annotation: createChatAnnotationFixture('Edited response') }}
      content="Original response"
    />,
  )
  expect(await screen.findByText('Edited response')).toBeInTheDocument()
  expect(screen.queryByText('Original response')).not.toBeInTheDocument()
})

it('shows the final response instead of superseded thoughts', async () => {
  render(
    <AgentContent
      item={{ ...item, agent_thoughts: [thought({ thought: 'Superseded thought' })] }}
      content="Final response"
    />,
  )
  expect(await screen.findByText('Final response')).toBeInTheDocument()
  expect(screen.queryByText('Superseded thought')).not.toBeInTheDocument()
})

it('shows tool progress and results alongside thought text until the response finishes', async () => {
  const user = userEvent.setup()
  const answer: ChatItem = {
    ...item,
    agent_thoughts: [
      thought({ thought: 'Search documents', tool: 'search', observation: 'Found a document' }),
      thought({ id: 'thought-2', thought: 'Fetch details', tool: 'fetch', position: 1 }),
    ],
  }
  const { rerender } = render(<AgentContent item={answer} responding />)
  expect(await screen.findByText('Search documents')).toBeInTheDocument()
  expect(screen.getByText('Fetch details')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'tools.thought.used search' }))
  expect(screen.getByText('Found a document')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'tools.thought.using fetch' })).toBeInTheDocument()
  rerender(<AgentContent item={answer} responding={false} />)
  expect(screen.getByRole('button', { name: 'tools.thought.used fetch' })).toBeInTheDocument()
})

it('preserves normalized streaming attachment names and download actions', () => {
  render(
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
  expect(screen.getByRole('button', { name: 'report.pdf' })).toBeInTheDocument()
  expect(screen.getByText('notes.txt')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'common.operation.download' })).toHaveLength(2)
})

it('renders historical attachments resolved from thought file ids', () => {
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
  render(<AgentContent item={{ ...item, agent_thoughts: thoughts }} />)
  expect(screen.getByRole('button', { name: 'history.pdf' })).toBeInTheDocument()
})
