import type {
  KnowledgeFsTidyDocumentCardResponse,
  KnowledgeFsTidyFindingResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { PlanConfirmation } from '../card-parts'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DuplicateGroupCard } from '../duplicate-group-card'
import { groupDuplicates } from '../review'

const evidence = (documentId: string) => ({
  documentId,
  revision: 1,
  title: 'Handbook',
  chunkId: 'chunk',
  start: 0,
  end: 7,
  text: 'Welcome',
})
const copy = (id: string, left: string, right: string): KnowledgeFsTidyFindingResponse => ({
  id,
  kind: 'duplicate',
  left: evidence(left),
  right: evidence(right),
  reason: 'identical_content_hash',
  similarity: 1,
  status: 'open',
  revision: 1,
  actionId: null,
  createdAt: '2026-11-09',
  stale: false,
})
const card = (title: string, publishedAt: string): KnowledgeFsTidyDocumentCardResponse => ({
  title,
  mimeType: 'text/html',
  sizeBytes: 2048,
  publishedAt,
  enabled: true,
})

describe('DuplicateGroupCard', () => {
  it('falls back to the newest copy when the chosen one leaves the group on refresh', async () => {
    const onConfirm = vi.fn<(confirmation: PlanConfirmation) => void>()
    const props = { busy: false, canManage: true, complete: true, spaceId: 'space', onConfirm }
    const older = card('Handbook', '2026-01-01T00:00:00Z')
    const newest = card('Handbook v3', '2026-08-01T00:00:00Z')
    const [three] = groupDuplicates([copy('d1', 'c', 'd'), copy('d2', 'd', 'e')])
    const [two] = groupDuplicates([copy('d1', 'c', 'd')])
    const user = userEvent.setup()
    const view = render(
      <DuplicateGroupCard
        {...props}
        group={three!}
        cards={{ c: older, d: newest, e: card('Handbook (copy)', '2026-03-01T00:00:00Z') }}
        onRewrite={vi.fn()}
        onRun={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('radio', { name: 'Handbook (copy)' }))
    expect(screen.getByRole('radio', { name: 'Handbook (copy)' })).toBeChecked()

    // The poll returns: that copy was handled elsewhere and is no longer part of the group.
    view.rerender(
      <DuplicateGroupCard
        {...props}
        group={two!}
        cards={{ c: older, d: newest }}
        onRewrite={vi.fn()}
        onRun={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByRole('radio', { name: 'Handbook v3' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Handbook' })).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'knowledgeSpace.tidy.keepNewestMerge' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(
      onConfirm.mock.calls[0]?.[0].plan.map((step) => [
        step.finding.id,
        step.action,
        step.documentId,
      ]),
    ).toEqual([['d1', 'disable_document', 'c']])
  })
  it('offers no keep-one merge and names no newest copy for a group that may lack copies', () => {
    const onRun = vi.fn()
    const [group] = groupDuplicates([copy('d1', 'c', 'd')])
    render(
      <DuplicateGroupCard
        busy={false}
        canManage
        complete={false}
        spaceId="space"
        group={group!}
        cards={{
          c: card('Handbook', '2026-01-01T00:00:00Z'),
          d: card('Handbook v3', '2026-08-01T00:00:00Z'),
        }}
        onConfirm={vi.fn()}
        onRewrite={vi.fn()}
        onRun={onRun}
      />,
    )
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Merge/ })).not.toBeInTheDocument()
    expect(screen.queryByText('knowledgeSpace.tidy.latest')).not.toBeInTheDocument()
    expect(screen.queryByText(/knowledgeSpace\.tidy\.newestIs/)).not.toBeInTheDocument()
    // Dismissing touches only the findings shown and disables nothing, so it stays.
    expect(screen.getByRole('button', { name: 'knowledgeSpace.tidy.keepAll' })).toBeEnabled()
  })
})
