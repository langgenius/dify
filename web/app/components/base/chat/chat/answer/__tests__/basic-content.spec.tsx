import type { ChatItem } from '../../../types'
import { screen } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createChatAnnotationFixture } from '@/test/fixtures/chat'
import BasicContent from '../basic-content'

const item: ChatItem = { id: 'answer', content: 'Original answer', isAnswer: true }

it.each(['Edited answer', ''])(
  'replaces the answer with its saved annotation %j',
  async (content) => {
    const { rerender } = render(<BasicContent item={item} />)
    expect(await screen.findByText('Original answer')).toBeInTheDocument()
    rerender(<BasicContent item={{ ...item, annotation: createChatAnnotationFixture(content) }} />)
    expect(screen.queryByText('Original answer')).not.toBeInTheDocument()
    if (content) expect(await screen.findByText(content)).toBeInTheDocument()
  },
)

it.each(['\\\\server\\share\\file.txt', '`\\\\server\\share\\file.txt`'])(
  'preserves the visible Windows path from %j',
  async (content) => {
    render(<BasicContent item={{ ...item, content }} />)
    expect(await screen.findByText('\\\\server\\share\\file.txt')).toBeInTheDocument()
  },
)

it('preserves a backslash string that is not a UNC path', async () => {
  render(<BasicContent item={{ ...item, content: '\\not-a-unc' }} />)
  expect(await screen.findByText('\\not-a-unc')).toBeInTheDocument()
})

it('resolves Workflow Agent knowledge receipts without accepting invented sources', async () => {
  const id = `kfs_${'a'.repeat(32)}`
  const receipt: ChatItem = {
    ...item,
    content: `[Manual](kfs://${id})`,
    citation: [
      {
        dataset_id: 'space',
        dataset_name: 'Docs',
        document_id: 'doc',
        document_name: 'Manual',
        data_source_type: 'knowledge_fs',
        content: 'evidence',
        segment_id: 'node',
        index_node_hash: 'hash',
        hit_count: 0,
        score: 0,
        word_count: 1,
        segment_position: 1,
        knowledge_fs_citation: {
          id,
          control_space_id: '00000000-0000-4000-8000-000000000001',
          space_name: 'Docs',
          node_id: 'node',
          document_asset_id: 'doc',
          artifact_hash: 'hash',
        },
      },
    ],
  }
  const { rerender } = render(<BasicContent item={receipt} />)
  expect(await screen.findByRole('link', { name: 'Manual' })).toHaveAttribute('href', `#${id}`)
  rerender(<BasicContent item={{ ...receipt, citation: [] }} />)
  expect(screen.queryByRole('link', { name: 'Manual' })).not.toBeInTheDocument()
  expect(await screen.findByText('Manual')).toBeInTheDocument()
})
