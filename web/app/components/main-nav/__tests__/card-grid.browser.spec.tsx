import { cn } from '@langgenius/dify-ui/cn'
import { render } from 'vitest-browser-react'
import { APP_LIST_GRID_CLASS_NAME } from '@/app/components/apps/constants'
import { MAIN_NAV_APP_CARD_GRID_CLASS_NAME } from '../app-card-grid'

const cardIds = ['first', 'second', 'third', 'fourth']

function CardGrid({
  className,
  label,
  width,
}: {
  className: string
  label: string
  width: number
}) {
  return (
    <section aria-label={label} className={className} style={{ width }}>
      {cardIds.map((id) => (
        <article key={id} aria-label={id} className="h-10" />
      ))}
    </section>
  )
}

describe('Main navigation card grid', () => {
  it('aligns Studio starred and app cards and remains overflow-free in a narrow container', async () => {
    // happy-dom does not resolve CSS Grid tracks or browser layout geometry.
    const screen = await render(
      <>
        <CardGrid label="Starred apps" className={APP_LIST_GRID_CLASS_NAME} width={1264} />
        <CardGrid label="All apps" className={APP_LIST_GRID_CLASS_NAME} width={1264} />
        <CardGrid
          label="Narrow card grid"
          className={cn('gap-2.5', MAIN_NAV_APP_CARD_GRID_CLASS_NAME)}
          width={280}
        />
      </>,
    )

    const starredGrid = screen.getByRole('region', { name: 'Starred apps' })
    const starredGridRect = starredGrid.element().getBoundingClientRect()
    const starredCardRects = starredGrid
      .getByRole('article')
      .elements()
      .map((element) => element.getBoundingClientRect())
    const appCardRects = screen
      .getByRole('region', { name: 'All apps' })
      .getByRole('article')
      .elements()
      .map((element) => element.getBoundingClientRect())

    expect(new Set(starredCardRects.map((rect) => rect.top)).size).toBe(1)
    expect(starredCardRects[0]!.left - starredGridRect.left).toBeCloseTo(32)
    expect(starredCardRects[0]!.width).toBeCloseTo(292.5)
    expect(starredGridRect.right - starredCardRects.at(-1)!.right).toBeCloseTo(32)
    expect(appCardRects.map(({ left, width }) => ({ left, width }))).toEqual(
      starredCardRects.map(({ left, width }) => ({ left, width })),
    )

    const narrowGrid = screen.getByRole('region', { name: 'Narrow card grid' })
    const narrowGridElement = narrowGrid.element()
    const narrowCardRects = narrowGrid
      .getByRole('article')
      .elements()
      .map((element) => element.getBoundingClientRect())

    expect(new Set(narrowCardRects.map((rect) => rect.top)).size).toBe(4)
    expect(narrowCardRects.every((rect) => Math.abs(rect.width - 280) < 0.1)).toBe(true)
    expect(narrowGridElement.scrollWidth).toBe(narrowGridElement.clientWidth)
  })
})
