import type { CitationItem } from '../../type'
import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderChat } from '../../__tests__/chat-browser-test-env'
import Citation from '../index'
import { citation } from './citation-preset'

vi.unmock('react-i18next')
// boundary: citation destinations are inspected without bootstrapping the Next router.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

beforeEach(async () => {
  await page.viewport(900, 700)
  onTestFinished(guardUnexpectedFetch())
})

const sources = ['Alpha reference', 'Beta reference', 'Gamma reference'].map((name, index) =>
  citation({ document_id: `doc-${index}`, document_name: name }),
)
function References({ data = sources, width = 600 }: { data?: CitationItem[]; width?: number }) {
  return (
    <>
      <button>Before references</button>
      <section aria-label="Answer references" className="chat-answer-container" style={{ width }}>
        <Citation data={data} />
      </section>
    </>
  )
}

it('fits actual citation text and the overflow control, recalculating when data and available width change', async () => {
  const screen = await renderChat(<References data={[sources[0]!]} width={300} />)
  await expect.element(screen.getByRole('button', { name: 'Alpha reference' })).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Expand CITATIONS' }))
    .not.toBeInTheDocument()
  await screen.rerender(<References width={300} />)
  const expand = screen.getByRole('button', { name: 'Expand CITATIONS' })
  await expect.element(expand).toHaveTextContent('+ 2')
  await expect
    .element(screen.getByRole('button', { name: 'Beta reference' }))
    .not.toBeInTheDocument()
  const region = screen.getByRole('region', { name: 'Answer references' })
  await expect.element(region).toBeVisible()
  expect(expand.element().getBoundingClientRect().right).toBeLessThanOrEqual(
    region.element().getBoundingClientRect().right,
  )
  await screen.getByRole('button', { name: 'Before references' }).click()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'Alpha reference' })).toHaveFocus()
  await userEvent.tab()
  await expect.element(expand).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const collapse = screen.getByRole('button', { name: 'Collapse CITATIONS' })
  await expect.element(collapse).toHaveFocus()
  await expect.element(screen.getByRole('button', { name: 'Gamma reference' })).toBeVisible()
  await userEvent.keyboard('{Space}')
  await expect
    .element(screen.getByRole('button', { name: 'Gamma reference' }))
    .not.toBeInTheDocument()
  await expect.element(expand).toHaveFocus()
  await screen.rerender(<References width={60} />)
  await expect.element(expand).toHaveTextContent('+ 3')
  await expand.click()
  await expect.element(screen.getByRole('button', { name: 'Gamma reference' })).toBeVisible()
  await collapse.click()
  await screen.rerender(<References />)
  await expect.element(expand).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Gamma reference' })).toBeVisible()
})

it('groups segments from one document into a real popup and restores the source trigger after Escape', async () => {
  const screen = await renderChat(
    <References
      data={[
        citation({ document_name: 'Report', content: 'First passage' }),
        citation({
          document_name: 'Report',
          content: 'Second passage',
          segment_id: 's2',
          segment_position: 2,
        }),
        citation({ document_id: 'other', document_name: 'Other report' }),
      ]}
    />,
  )
  const trigger = screen.getByRole('button', { name: 'Report', exact: true })
  await trigger.click()
  const dialog = screen.getByRole('dialog')
  await expect.element(dialog.getByText('First passage')).toBeVisible()
  await expect.element(dialog.getByText('Second passage')).toBeVisible()
  await expect.element(dialog.getByRole('link')).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(dialog.getByText('Second passage')).toBeVisible()
})

it('keeps KnowledgeFS spaces and document versions separate with public receipt targets', async () => {
  const data = ['space-a', 'space-b', 'space-a'].map((space, index) =>
    citation({
      data_source_type: 'knowledge_fs',
      dataset_id: space,
      document_id: 'shared',
      document_name: `Shared ${index}`,
      document_version: index === 2 ? 2 : 1,
      knowledge_fs_citation: {
        id: `kfs_${String(index).repeat(32)}`,
        control_space_id: '00000000-0000-4000-8000-000000000001',
        space_name: space,
        node_id: `node-${index}`,
        document_asset_id: 'shared',
        artifact_hash: `hash-${index}`,
      },
    }),
  )
  const screen = await renderChat(<References data={data} />)
  for (const source of data) {
    const trigger = screen.getByRole('button', { name: source.document_name })
    await expect.element(trigger).toBeVisible()
    // Receipt IDs are the public destinations of kfs:// Markdown links.
    expect(document.getElementById(source.knowledge_fs_citation!.id)).not.toBeNull()
    await trigger.click()
    await expect.element(screen.getByRole('dialog').getByText('Evidence passage')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  }
})
