import type { CitationItem } from '../../type'
import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { chatItem, renderChatOwner } from '../../__tests__/chat-owner-preset'
import Answer from '../index'
import { pendingForm } from './answer-form-preset'

vi.unmock('react-i18next')
// boundary: citation destinations read Next route params outside an application.
vi.mock('@/next/navigation', () => ({
  useParams: () => ({}),
  usePathname: () => '/chat',
  useRouter: () => ({ push: vi.fn() }),
}))

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
})

const source: CitationItem = {
  content: 'Supporting passage',
  data_source_type: 'upload_file',
  dataset_name: 'Knowledge',
  dataset_id: 'dataset-1',
  document_id: 'document-1',
  document_name: 'Source.pdf',
  hit_count: 1,
  index_node_hash: 'hash',
  segment_id: 'segment-1',
  segment_position: 1,
  score: 0.9,
  word_count: 2,
}

it.each([false, true])(
  'reveals sources after streaming, and opens/closes the real evidence popup with human inputs = %s',
  async (human) => {
    const item = chatItem({
      citation: [source],
      humanInputFormDataList: human ? [pendingForm] : undefined,
    })
    const screen = await renderChatOwner(
      <Answer item={item} question="Question" index={0} responding />,
    )
    await expect
      .element(page.getByRole('button', { name: 'Source.pdf', exact: true }))
      .not.toBeInTheDocument()
    await screen.rerender(<Answer item={item} question="Question" index={0} responding={false} />)
    const trigger = page.getByRole('button', { name: 'Source.pdf', exact: true })
    await trigger.click()
    await expect.element(page.getByRole('dialog').getByText('Supporting passage')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  },
)

it('follows a verified receipt to its actual source with native scroll, and removes an unverified link', async () => {
  const id = `kfs_${'a'.repeat(32)}`
  const receipt: CitationItem = {
    ...source,
    data_source_type: 'knowledge_fs',
    document_name: 'Manual',
    knowledge_fs_citation: {
      id,
      control_space_id: '00000000-0000-4000-8000-000000000001',
      space_name: 'Docs',
      node_id: 'node',
      document_asset_id: 'doc',
      artifact_hash: 'hash',
    },
  }
  const item = chatItem({
    content: `[Manual](kfs://${id})\n\n${'Readable answer paragraph.\n\n'.repeat(30)}`,
    citation: [receipt],
  })
  const wrap = (citation: CitationItem[]) => (
    <section aria-label="Answer" style={{ height: 450, overflowY: 'auto' }}>
      <Answer item={{ ...item, citation }} question="Question" index={0} />
    </section>
  )
  const screen = await renderChatOwner(wrap([receipt]))
  const link = page.getByRole('link', { name: 'Manual', exact: true })
  await expect.element(link).toHaveAttribute('href', `#${id}`)
  const scroller = page.getByRole('region', { name: 'Answer' })
  const target = page.getByRole('button', { name: 'Manual', exact: true })
  await expect.element(target).toBeInTheDocument()
  await expect.element(scroller).toBeVisible()
  const region = scroller.element()
  const sourceElement = target.element()
  expect(sourceElement.getBoundingClientRect().top).toBeGreaterThan(
    region.getBoundingClientRect().bottom,
  )
  await link.click()
  await expect.poll(() => region.scrollTop).toBeGreaterThan(0)
  await expect
    .poll(() => sourceElement.getBoundingClientRect().bottom)
    .toBeLessThanOrEqual(region.getBoundingClientRect().bottom + 1)
  await screen.rerender(wrap([]))
  await expect.element(link).not.toBeInTheDocument()
  await expect.element(page.getByText('Manual', { exact: true })).toBeInTheDocument()
})
