import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { VirtualizedCardGrid } from '..'

vi.mock('@tanstack/react-virtual')

type Card = { id: string; name: string }

const cards: Card[] = [
  { id: 'a', name: 'Card A' },
  { id: 'b', name: 'Card B' },
  { id: 'c', name: 'Card C' },
]

const renderGrid = (items: Card[] = cards, renderItem?: (item: Card, index: number) => ReactNode) =>
  render(
    <VirtualizedCardGrid
      className="grid grid-cols-[repeat(auto-fill,minmax(288px,1fr))] gap-2.5"
      getItemKey={(item) => item.id}
      items={items}
      renderItem={
        renderItem ??
        ((item) => (
          <div key={item.id} data-testid={`card-${item.id}`}>
            {item.name}
          </div>
        ))
      }
      rowHeight={166}
      scrollContainerRef={createRef<HTMLDivElement>()}
    />,
  )

describe('VirtualizedCardGrid', () => {
  it('renders each card inside a positioned row', () => {
    renderGrid()

    const row = screen.getByTestId('card-a').closest('div.absolute')
    expect(row).not.toBeNull()
    expect(row).toHaveStyle({ height: '166px' })
  })

  it('sizes the container to the whole list so rows outside the viewport can be skipped', () => {
    renderGrid()

    // No stylesheet resolves the grid tracks here, so each card occupies its own row.
    const container = screen.getByTestId('card-a').closest('div.absolute')!.parentElement
    expect(container).toHaveStyle({ height: '498px' })
  })

  it('passes the position within the whole list to renderItem', () => {
    const seen: number[] = []
    renderGrid(cards, (item, index) => {
      seen.push(index)
      return <div key={item.id} data-testid={`card-${item.id}`} />
    })

    expect(seen).toEqual([0, 1, 2])
  })

  it('renders nothing for an empty list', () => {
    const { container } = renderGrid([])

    expect(container.querySelector('div.absolute')).toBeNull()
  })
})
