import type { HitTesting } from '@/models/datasets'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vite-plus/test'
import { ResultItem } from '../result-item'

function makePayload(
  overrides: Partial<Omit<HitTesting, 'segment' | 'content'>> & {
    segment?: Partial<HitTesting['segment']>
  } = {},
): HitTesting {
  const segment: HitTesting['segment'] = {
    id: 'segment-1',
    position: 1,
    word_count: 100,
    content: 'Preview content',
    sign_content: '',
    keywords: [],
    document: {
      id: 'document-1',
      name: 'file.pdf',
      data_source_type: 'upload_file',
      doc_type: 'book',
    },
    answer: '',
    tokens: 20,
    hit_count: 1,
    index_node_hash: 'hash-1',
    ...overrides.segment,
  }
  return {
    score: 0.95,
    tsne_position: { x: 0, y: 0 },
    child_chunks: [],
    files: [],
    ...overrides,
    segment,
    content: segment,
  }
}

const dialogName = 'datasetHitTesting.chunkDetail'
const triggerName = 'datasetHitTesting.open file.pdf'
const closeName = 'common.operation.close'

describe('ResultItem detail entries', () => {
  it('opens from metadata and closes without a portalled click reopening the card', async () => {
    const user = userEvent.setup()
    render(<ResultItem payload={makePayload()} />)
    await user.click(screen.getByText('Chunk-01'))
    const dialog = screen.getByRole('dialog', { name: dialogName })
    await user.click(await within(dialog).findByText('Preview content'))
    await user.click(within(dialog).getByRole('button', { name: closeName }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: triggerName })).toHaveFocus()
  })

  it('opens from the fixed footer by keyboard and can reopen after Escape', async () => {
    const user = userEvent.setup()
    render(<ResultItem payload={makePayload()} />)
    const trigger = screen.getByRole('button', { name: triggerName })
    trigger.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
    await user.keyboard(' ')
    expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument()
  })

  it('opens from Markdown text and leaves a Markdown link to its own action', async () => {
    const user = userEvent.setup()
    render(
      <ResultItem
        payload={makePayload({
          segment: { content: 'Preview text\n\n[Reference](https://example.com)' },
        })}
      />,
    )
    const link = await screen.findByRole('link', { name: 'Reference' })
    expect(link).toHaveAttribute('href', 'https://example.com/')
    await user.click(link)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByText('Preview text'))
    expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument()
  })

  it('folds child chunks by keyboard without opening details and retains the fold across sessions', async () => {
    const user = userEvent.setup()
    render(
      <ResultItem
        payload={makePayload({
          segment: { keywords: ['Hidden parent keyword'] },
          child_chunks: [{ id: 'child-1', content: 'Child preview', position: 1, score: 0.8 }],
        })}
      />,
    )
    const fold = screen.getByRole('button', { name: /datasetHitTesting.hitChunks/ })
    expect(fold).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Child preview')).toBeInTheDocument()
    expect(screen.queryByText('Hidden parent keyword')).not.toBeInTheDocument()
    fold.focus()
    await user.keyboard('{Enter}')
    expect(fold).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Child preview')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: triggerName }))
    expect(within(screen.getByRole('dialog')).getByText('Child preview')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: closeName }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fold).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Child preview')).not.toBeInTheDocument()
    fold.focus()
    await user.keyboard(' ')
    expect(fold).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Child preview')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
