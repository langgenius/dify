import type { CitationItem } from '../../type'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import Citation from '../index'

const makeCitationItem = (overrides: Partial<CitationItem> = {}): CitationItem => ({
  document_id: 'doc-1',
  document_name: 'Document One',
  data_source_type: 'upload_file',
  segment_id: 'seg-1',
  content: 'Some content',
  dataset_id: 'dataset-1',
  dataset_name: 'Dataset One',
  segment_position: 1,
  word_count: 100,
  hit_count: 5,
  index_node_hash: 'abc123',
  score: 0.95,
  ...overrides,
})

let containerWidth: number
let resize: () => void
const disconnect = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  containerWidth = 840
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains('chat-answer-container')) return containerWidth
    return this.dataset.testid === 'citation-measurement-item' ? 80 : 0
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private callback: () => void
      constructor(callback: () => void) {
        this.callback = callback
      }
      observe(target: HTMLElement) {
        if (target.classList.contains('chat-answer-container')) resize = this.callback
      }
      unobserve() {}
      disconnect = disconnect
    },
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const sources = ['Alpha', 'Beta', 'Gamma'].map((name, index) =>
  makeCitationItem({
    document_id: `doc-${index}`,
    document_name: name,
  }),
)
const renderCitations = (data = sources, showHitInfo = false) =>
  renderWithConsoleQuery(
    <div className="chat-answer-container">
      <Citation data={data} showHitInfo={showHitInfo} />
    </div>,
  )
const expand = () =>
  screen.getByRole('button', { name: 'share.chat.expand common.chat.citation.title' })

describe('Citation', () => {
  it('shows each document once and opens all of its cited segments', async () => {
    const user = userEvent.setup()
    renderCitations([
      makeCitationItem({
        document_name: 'Report',
        segment_id: 's1',
        segment_position: 1,
        content: 'First passage',
      }),
      makeCitationItem({
        document_name: 'Report',
        segment_id: 's2',
        segment_position: 2,
        content: 'Second passage',
      }),
      makeCitationItem({ document_id: 'other', document_name: 'Other report' }),
    ])
    expect(screen.getAllByRole('button')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Report' }))
    const popup = await screen.findByTestId('popup-content')
    expect(within(popup).getByText('First passage')).toBeVisible()
    expect(within(popup).getByText('Second passage')).toBeVisible()
    expect(within(popup).queryByRole('link')).not.toBeInTheDocument()
  })

  it('offers the source dataset when hit information is enabled', async () => {
    const user = userEvent.setup()
    renderCitations([makeCitationItem()], true)
    await user.click(screen.getByRole('button', { name: 'Document One' }))
    expect(
      await screen.findByRole('link', { name: 'common.chat.citation.linkToDataset' }),
    ).toHaveAttribute('href', '/datasets/dataset-1/documents/doc-1')
    expect(screen.getByTestId('popup-hit-info')).toHaveTextContent('100')
  })

  it('keeps KnowledgeFS spaces and document versions separate while exposing receipt anchors', () => {
    const data = ['space-a', 'space-b', 'space-a'].map((space, index) =>
      makeCitationItem({
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
    const { container } = renderCitations(data)
    for (const source of data) {
      expect(screen.getByRole('button', { name: source.document_name })).toBeInTheDocument()
      expect(
        container.querySelector(`[id="${source.knowledge_fs_citation!.id}"]`),
      ).toBeInTheDocument()
    }
  })

  it.each([
    [840, ['Alpha', 'Beta', 'Gamma'], 0],
    [250, ['Alpha', 'Beta'], 1],
    [240, ['Alpha'], 2],
    [140, [], 3],
    [60, [], 3],
  ] as const)(
    'fits citations and the overflow control in a %s pixel container',
    (width, visible, hidden) => {
      containerWidth = width
      renderCitations()
      for (const name of ['Alpha', 'Beta', 'Gamma']) {
        if (new Set<string>(visible).has(name))
          expect(screen.getByRole('button', { name })).toBeInTheDocument()
        else expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
      }
      if (hidden) expect(expand()).toHaveTextContent(`+ ${hidden}`)
      else
        expect(screen.queryByRole('button', { name: /share.chat.expand/ })).not.toBeInTheDocument()
    },
  )

  it.each(['pointer', 'Enter', 'Space'])(
    'expands and collapses the complete citation list using %s',
    async (interaction) => {
      const user = userEvent.setup()
      containerWidth = 140
      renderCitations()
      const toggle = expand()
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      if (interaction === 'pointer') await user.click(toggle)
      else {
        toggle.focus()
        await user.keyboard(interaction === 'Enter' ? '{Enter}' : ' ')
      }
      for (const name of ['Alpha', 'Beta', 'Gamma'])
        expect(screen.getByRole('button', { name })).toBeInTheDocument()
      const collapse = screen.getByRole('button', {
        name: 'share.chat.collapse common.chat.citation.title',
      })
      expect(collapse).toHaveAttribute('aria-expanded', 'true')
      await user.click(collapse)
      expect(expand()).toHaveTextContent('+ 3')
      expect(screen.queryByRole('button', { name: 'Alpha' })).not.toBeInTheDocument()
    },
  )

  it('recalculates the visible count when citations arrive or the container resizes', () => {
    containerWidth = 240
    const { rerender, unmount } = renderCitations([sources[0]!])
    expect(screen.queryByRole('button', { name: /share.chat.expand/ })).not.toBeInTheDocument()
    rerender(
      <div className="chat-answer-container">
        <Citation data={sources} />
      </div>,
    )
    expect(expand()).toHaveTextContent('+ 2')
    containerWidth = 840
    act(() => resize())
    expect(screen.queryByRole('button', { name: /share.chat.expand/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gamma' })).toBeInTheDocument()
    unmount()
    expect(disconnect).toHaveBeenCalled()
  })
})
