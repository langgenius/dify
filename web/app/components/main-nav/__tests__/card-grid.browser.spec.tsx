import { cn } from '@langgenius/dify-ui/cn'
import { render } from 'vitest-browser-react'
import { MAIN_NAV_APP_CARD_GRID_CLASS_NAME } from '../app-card-grid'

const cardIds = ['first', 'second', 'third', 'fourth']

function CardGrid({ label, width }: { label: string; width: number }) {
  return (
    <section
      aria-label={label}
      className={cn('gap-2.5', MAIN_NAV_APP_CARD_GRID_CLASS_NAME)}
      style={{ width }}
    >
      {cardIds.map((id) => (
        <article key={id} aria-label={id} className="h-10" />
      ))}
    </section>
  )
}

describe('Main navigation card grid', () => {
  it('uses four aligned tracks at 1200px and one overflow-free track at 280px in Chromium', async () => {
    // happy-dom does not resolve CSS Grid tracks or browser layout geometry.
    const screen = await render(
      <>
        <CardGrid label="Wide card grid" width={1200} />
        <CardGrid label="Narrow card grid" width={280} />
      </>,
    )

    const wideGrid = screen.getByRole('region', { name: 'Wide card grid' })
    const wideGridRect = wideGrid.element().getBoundingClientRect()
    const wideCardRects = wideGrid
      .getByRole('article')
      .elements()
      .map((element) => element.getBoundingClientRect())

    expect(new Set(wideCardRects.map((rect) => rect.top)).size).toBe(1)
    expect(wideCardRects[0]!.width).toBeCloseTo(292.5)
    expect(wideCardRects.at(-1)!.right).toBeCloseTo(wideGridRect.right)

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
