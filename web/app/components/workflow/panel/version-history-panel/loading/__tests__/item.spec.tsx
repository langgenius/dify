import { render } from '@testing-library/react'
import Item from '../item'

describe('VersionHistoryLoadingItem', () => {
  it('renders connectors and placeholders based on first and last flags', () => {
    const { container, rerender } = render(
      <Item
        isFirst={false}
        isLast={false}
        releaseNotesWidth="w-24"
        titleWidth="w-40"
      />,
    )

    expect(container.querySelector('.bg-divider-subtle')).toBeInTheDocument()
    expect(container.querySelector('.w-40')).toBeInTheDocument()
    expect(container.querySelector('.w-24')).toBeInTheDocument()

    rerender(
      <Item
        isFirst
        isLast
        releaseNotesWidth="w-24"
        titleWidth="w-40"
      />,
    )

    expect(container.querySelector('.bg-divider-subtle')).not.toBeInTheDocument()
  })
})
