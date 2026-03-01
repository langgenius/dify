import type { CitationItem } from '../type'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Citation from './index'

vi.mock('./popup', () => ({
  default: ({ data, showHitInfo }: { data: { documentName: string }, showHitInfo?: boolean }) => (
    <div data-testid="popup" data-show-hit-info={String(!!showHitInfo)}>
      {data.documentName}
    </div>
  ),
}))

const originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')

type ClientWidthConfig = {
  container: number
  item: number
}

const mockClientWidths = ({ container, item }: ClientWidthConfig) => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    get() {
      const el = this as HTMLElement
      if (el.className?.includes?.('chat-answer-container') || el.className?.includes?.('my-custom-container'))
        return container
      if (el.dataset?.testid === 'citation-measurement-item')
        return item
      return 0
    },
    configurable: true,
  })
}

const restoreClientWidth = () => {
  if (originalClientWidthDescriptor)
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidthDescriptor)
}

afterAll(() => {
  restoreClientWidth()
})

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

const setupContainer = (className = 'chat-answer-container') => {
  const wrapper = document.createElement('div')
  wrapper.className = className
  document.body.appendChild(wrapper)
  return wrapper
}

describe('Citation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    restoreClientWidth()
  })

  describe('Rendering', () => {
    it('should render the citation title section', () => {
      mockClientWidths({ container: 500, item: 50 })
      setupContainer()
      render(<Citation data={[makeCitationItem()]} />)
      expect(screen.getByTestId('citation-title')).toBeInTheDocument()
    })

    it('should render one measurement ghost item per unique document', () => {
      mockClientWidths({ container: 500, item: 50 })
      setupContainer()
      render(
        <Citation data={[
          makeCitationItem({ document_id: 'doc-1', document_name: 'Alpha' }),
          makeCitationItem({ document_id: 'doc-2', document_name: 'Beta' }),
        ]}
        />,
      )
      expect(screen.getAllByTestId('citation-measurement-item')).toHaveLength(2)
    })

    it('should display the document name inside each measurement item', () => {
      mockClientWidths({ container: 500, item: 50 })
      setupContainer()
      render(<Citation data={[makeCitationItem({ document_name: 'My Report' })]} />)
      expect(screen.getByTestId('citation-measurement-item')).toHaveTextContent('My Report')
    })

    it('should render a popup for each resource that fits within the container', () => {
      mockClientWidths({ container: 840, item: 50 })
      setupContainer()
      render(
        <Citation data={[
          makeCitationItem({ document_id: 'doc-1' }),
          makeCitationItem({ document_id: 'doc-2' }),
        ]}
        />,
      )
      expect(screen.getAllByTestId('popup')).toHaveLength(2)
    })

    it('should render the citation title i18n key', () => {
      mockClientWidths({ container: 500, item: 50 })
      setupContainer()
      render(<Citation data={[makeCitationItem()]} />)
      expect(screen.getByText(/citation\.title/i)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should use chat-answer-container as the default containerClassName', () => {
      mockClientWidths({ container: 500, item: 50 })
      setupContainer()
      render(<Citation data={[makeCitationItem()]} />)
      expect(screen.getByTestId('citation-title')).toBeInTheDocument()
    })

    it('should use a custom containerClassName to resolve the container element', () => {
      mockClientWidths({ container: 600, item: 50 })
      setupContainer('my-custom-container')
      render(<Citation data={[makeCitationItem()]} containerClassName="my-custom-container" />)
      expect(screen.getByTestId('citation-title')).toBeInTheDocument()
    })

    it('should forward showHitInfo=true to each rendered Popup', () => {
      mockClientWidths({ container: 840, item: 50 })
      setupContainer()
      render(
        <Citation
          data={[
            makeCitationItem({ document_id: 'doc-1' }),
            makeCitationItem({ document_id: 'doc-2' }),
          ]}
          showHitInfo={true}
        />,
      )
      screen.getAllByTestId('popup').forEach(p =>
        expect(p).toHaveAttribute('data-show-hit-info', 'true'),
      )
    })

    it('should forward showHitInfo=false when prop is omitted', () => {
      mockClientWidths({ container: 840, item: 50 })
      setupContainer()
      render(<Citation data={[makeCitationItem({ document_id: 'doc-1' })]} />)
      screen.getAllByTestId('popup').forEach(p =>
        expect(p).toHaveAttribute('data-show-hit-info', 'false'),
      )
    })
  })

  describe('Resource Grouping', () => {
    it('should merge citations with the same document_id into one resource', () => {
      mockClientWidths({ container: 500, item: 50 })
      setupContainer()
      render(
        <Citation data={[
          makeCitationItem({ document_id: 'shared', segment_id: 'seg-1' }),
          makeCitationItem({ document_id: 'shared', segment_id: 'seg-2' }),
        ]}
        />,
      )
      expect(screen.getAllByTestId('citation-measurement-item')).toHaveLength(1)
    })

    it('should create a separate resource for each distinct document_id', () => {
      mockClientWidths({ container: 500, item: 50 })
      setupContainer()
      render(
        <Citation data={[
          makeCitationItem({ document_id: 'doc-a' }),
          makeCitationItem({ document_id: 'doc-b' }),
          makeCitationItem({ document_id: 'doc-c' }),
        ]}
        />,
      )
      expect(screen.getAllByTestId('citation-measurement-item')).toHaveLength(3)
    })

    it('should handle mixed shared and unique document_ids correctly', () => {
      mockClientWidths({ container: 500, item: 50 })
      setupContainer()
      render(
        <Citation data={[
          makeCitationItem({ document_id: 'doc-x', segment_id: 'seg-1' }),
          makeCitationItem({ document_id: 'doc-y', segment_id: 'seg-2' }),
          makeCitationItem({ document_id: 'doc-x', segment_id: 'seg-3' }),
        ]}
        />,
      )
      expect(screen.getAllByTestId('citation-measurement-item')).toHaveLength(2)
    })
  })

  describe('Layout Adjustment – all resources fit', () => {
    it('should show all popups and no more-toggle when every item fits within container', () => {
      // effective containerWidth = 840 - 40 = 800; each item = 50px → all 3 fit
      mockClientWidths({ container: 840, item: 50 })
      setupContainer()
      render(
        <Citation data={[
          makeCitationItem({ document_id: 'doc-1' }),
          makeCitationItem({ document_id: 'doc-2' }),
          makeCitationItem({ document_id: 'doc-3' }),
        ]}
        />,
      )
      expect(screen.getAllByTestId('popup')).toHaveLength(3)
      expect(screen.queryByTestId('citation-more-toggle')).not.toBeInTheDocument()
    })
  })

  describe('Layout Adjustment – overflow branch: setLimitNumberInOneLine(i - 1)', () => {
    it('should show more-toggle when backed-out totalWidth + 34 still exceeds containerWidth', () => {
      // effective = 140 - 40 = 100
      // i=0: total=80, 80+0=80 ≤ 100 → limit=1
      // i=1: total=160, 160+4=164 > 100 → overflow; back-out=80; 80+34=114 > 100 → setLimit(0)
      // 0 < 2 → toggle shown
      mockClientWidths({ container: 140, item: 80 })
      setupContainer()
      render(
        <Citation data={[
          makeCitationItem({ document_id: 'doc-1', document_name: 'Doc A' }),
          makeCitationItem({ document_id: 'doc-2', document_name: 'Doc B' }),
        ]}
        />,
      )
      expect(screen.getByTestId('citation-more-toggle')).toBeInTheDocument()
    })
  })

  describe('Layout Adjustment – overflow branch: setLimitNumberInOneLine(i)', () => {
    it('should show more-toggle and limit=i when backed-out totalWidth + 34 fits within containerWidth', () => {
      // effective = 240 - 40 = 200
      // i=0: 80+0=80 ≤ 200 → limit=1
      // i=1: 160+4=164 ≤ 200 → limit=2
      // i=2: 240+8=248 > 200 → overflow; back-out=160; 160+34=194 ≤ 200 → setLimit(2)
      // 2 < 3 → toggle shown; 2 popups visible
      mockClientWidths({ container: 240, item: 80 })
      setupContainer()
      render(
        <Citation data={[
          makeCitationItem({ document_id: 'doc-1', document_name: 'Doc A' }),
          makeCitationItem({ document_id: 'doc-2', document_name: 'Doc B' }),
          makeCitationItem({ document_id: 'doc-3', document_name: 'Doc C' }),
        ]}
        />,
      )
      expect(screen.getByTestId('citation-more-toggle')).toBeInTheDocument()
      expect(screen.getAllByTestId('popup')).toHaveLength(2)
    })
  })

  describe('Show More / Show Less Toggle', () => {
    const renderOverflowScenario = () => {
      // effective = 140 - 40 = 100; items=80px
      // i=0: 80 ≤ 100 → limit=1
      // i=1: 160+4=164 > 100 → overflow; back-out=80; 80+34=114 > 100 → setLimit(0)
      // 0 < 3 → toggle shown; 0 popups visible (slice(0, 0) = [])
      mockClientWidths({ container: 140, item: 80 })
      setupContainer()
      render(
        <Citation data={[
          makeCitationItem({ document_id: 'doc-1', document_name: 'Doc A' }),
          makeCitationItem({ document_id: 'doc-2', document_name: 'Doc B' }),
          makeCitationItem({ document_id: 'doc-3', document_name: 'Doc C' }),
        ]}
        />,
      )
      return screen.getByTestId('citation-more-toggle')
    }

    it('should show the overflow count label matching /+\\s*\\d+/ on the more-toggle in collapsed state', () => {
      renderOverflowScenario()
      expect(screen.getByTestId('citation-more-toggle').textContent).toMatch(/^\+\s*\d+$/)
    })

    it('should display the collapse icon div after clicking more-toggle to expand', async () => {
      const user = userEvent.setup()
      renderOverflowScenario()

      await user.click(screen.getByTestId('citation-more-toggle'))

      expect(document.querySelector('.i-ri-arrow-down-s-line')).toBeInTheDocument()
    })

    it('should return to the count label after clicking the toggle a second time to collapse', async () => {
      const user = userEvent.setup()
      renderOverflowScenario()

      await user.click(screen.getByTestId('citation-more-toggle'))
      await user.click(screen.getByTestId('citation-more-toggle'))

      expect(screen.getByTestId('citation-more-toggle').textContent).toMatch(/^\+\s*\d+$/)
    })

    it('should show all resource popups after expanding via the more-toggle', async () => {
      const user = userEvent.setup()
      renderOverflowScenario()

      await user.click(screen.getByTestId('citation-more-toggle'))

      await waitFor(() => {
        expect(screen.getAllByTestId('popup')).toHaveLength(3)
      })
    })
  })

  describe('Edge Cases', () => {
    it('should render without crashing when data is an empty array', () => {
      mockClientWidths({ container: 500, item: 0 })
      setupContainer()
      render(<Citation data={[]} />)
      expect(screen.getByTestId('citation-title')).toBeInTheDocument()
      expect(screen.queryAllByTestId('citation-measurement-item')).toHaveLength(0)
      expect(screen.queryByTestId('citation-more-toggle')).not.toBeInTheDocument()
    })

    it('should render correctly with a single citation item that fits', () => {
      mockClientWidths({ container: 500, item: 50 })
      setupContainer()
      render(<Citation data={[makeCitationItem()]} />)
      expect(screen.getAllByTestId('citation-measurement-item')).toHaveLength(1)
      expect(screen.queryByTestId('citation-more-toggle')).not.toBeInTheDocument()
    })

    it('should handle all citations sharing one document_id as a single resource', () => {
      mockClientWidths({ container: 500, item: 50 })
      setupContainer()
      render(
        <Citation data={[
          makeCitationItem({ document_id: 'only', segment_id: 's1' }),
          makeCitationItem({ document_id: 'only', segment_id: 's2' }),
          makeCitationItem({ document_id: 'only', segment_id: 's3' }),
        ]}
        />,
      )
      expect(screen.getAllByTestId('citation-measurement-item')).toHaveLength(1)
    })

    it('should handle a large number of citation items without throwing', () => {
      mockClientWidths({ container: 5000, item: 50 })
      setupContainer()
      const data = Array.from({ length: 20 }, (_, i) =>
        makeCitationItem({ document_id: `doc-${i}`, document_name: `Document ${i}` }))
      expect(() => render(<Citation data={data} />)).not.toThrow()
      expect(screen.getAllByTestId('citation-measurement-item')).toHaveLength(20)
    })
  })
})
