import type { ExternalKnowledgeBaseHitTesting } from '@/models/datasets'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResultItemExternal } from '../result-item-external'

const createExternalPayload = (
  overrides: Partial<ExternalKnowledgeBaseHitTesting> = {},
): ExternalKnowledgeBaseHitTesting => ({
  content: 'This is the chunk content for testing.',
  title: 'Test Document Title',
  score: 0.85,
  metadata: {
    'x-amz-bedrock-kb-source-uri': 's3://bucket/key',
    'x-amz-bedrock-kb-data-source-id': 'ds-123',
  },
  ...overrides,
})

const triggerName = 'datasetHitTesting.open Test Document Title'
const dialogName = 'datasetHitTesting.chunkDetail'

describe('ResultItemExternal', () => {
  it('opens the full result from the single named card button and closes back to it', async () => {
    const user = userEvent.setup()
    const payload = createExternalPayload()
    render(<ResultItemExternal payload={payload} positionId={3} />)

    const trigger = screen.getByRole('button', { name: triggerName })
    expect(trigger).toHaveAccessibleDescription(/Chunk-03.*0\.85/)
    expect(trigger).not.toHaveAccessibleDescription(/This is the chunk content/)
    expect(trigger.tagName).toBe('BUTTON')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(trigger).getByText('Chunk-03')).toBeInTheDocument()
    expect(within(trigger).getByText('0.85')).toBeInTheDocument()
    expect(within(trigger).getByText('Test Document Title')).toBeInTheDocument()

    await user.click(within(trigger).getByText(payload.content))
    const dialog = await screen.findByRole('dialog', { name: dialogName })
    expect(within(dialog).getByText(payload.content)).toBeInTheDocument()
    expect(within(dialog).getByText('Chunk-03')).toBeInTheDocument()
    expect(within(dialog).getByText('0.85')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it.each(['{Enter}', ' '])(
    'opens from %s and restores its trigger after Escape before reopening',
    async (key) => {
      const user = userEvent.setup()
      render(<ResultItemExternal payload={createExternalPayload()} positionId={1} />)
      const trigger = screen.getByRole('button', { name: triggerName })

      await user.tab()
      expect(trigger).toHaveFocus()
      await user.keyboard(key)
      await screen.findByRole('dialog', { name: dialogName })
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await waitFor(() => expect(trigger).toHaveFocus())
      await user.keyboard(key)
      expect(await screen.findByRole('dialog', { name: dialogName })).toBeInTheDocument()
    },
  )

  it('keeps empty results accessible by their document title without an absent score', async () => {
    const user = userEvent.setup()
    render(
      <ResultItemExternal
        payload={createExternalPayload({ content: '', score: 0 })}
        positionId={1}
      />,
    )
    const trigger = screen.getByRole('button', { name: triggerName })
    expect(within(trigger).queryByText('score')).not.toBeInTheDocument()
    await user.click(trigger)
    expect(await screen.findByRole('dialog', { name: dialogName })).toBeInTheDocument()
  })
})
