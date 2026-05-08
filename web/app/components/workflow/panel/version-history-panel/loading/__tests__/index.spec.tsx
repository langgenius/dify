import { render } from '@testing-library/react'
import Loading from '../index'
import Item from '../item'

describe('VersionHistory Loading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Individual skeleton items should hide optional rows based on edge flags.
  describe('Item', () => {
    it('should hide the release note placeholder for the first row', () => {
      const { container } = render(
        <Item
          titleWidth="w-1/3"
          releaseNotesWidth="w-3/4"
          isFirst
          isLast={false}
        />,
      )

      expect(container.querySelectorAll('.opacity-20')).toHaveLength(1)
      expect(container.querySelector('.bg-divider-subtle')).toBeInTheDocument()
    })

    it('should hide the timeline connector for the last row', () => {
      const { container } = render(
        <Item
          titleWidth="w-2/5"
          releaseNotesWidth="w-4/6"
          isFirst={false}
          isLast
        />,
      )

      expect(container.querySelectorAll('.opacity-20')).toHaveLength(2)
      expect(container.querySelector('.absolute.left-4.top-6')).not.toBeInTheDocument()
    })
  })

  // The loading list should render the configured number of timeline skeleton rows.
  describe('Loading List', () => {
    it('should render eight loading rows with the overlay mask', () => {
      const { container } = render(<Loading />)

      expect(container.querySelector('.bg-dataset-chunk-list-mask-bg')).toBeInTheDocument()
      expect(container.querySelectorAll('.relative.flex.gap-x-1.p-2')).toHaveLength(8)
      expect(container.querySelectorAll('.opacity-20')).toHaveLength(15)
    })
  })
})
