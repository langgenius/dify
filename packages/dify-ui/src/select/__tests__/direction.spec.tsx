import { DirectionProvider } from '@langgenius/dify-ui/direction-provider'
import { Select, SelectTrigger } from '@langgenius/dify-ui/select'
import { render } from 'vitest-browser-react'

describe.each(['ltr', 'rtl'] as const)('Select spacing in %s', (direction) => {
  it.each([
    { className: 'ps-0 pe-6', start: 0, end: 24 },
    { className: 'ps-2', start: 8, end: 4 },
    { className: 'px-2.5', start: 10, end: 10 },
    { className: 'p-0.5 ps-1', start: 4, end: 2 },
  ])('preserves the caller override $className', async ({ className, start, end }) => {
    const screen = await render(
      <DirectionProvider direction={direction}>
        <div dir={direction}>
          <Select>
            <SelectTrigger size="small" className={className} aria-label="City">
              Seattle
            </SelectTrigger>
          </Select>
        </div>
      </DirectionProvider>,
    )
    const style = getComputedStyle(screen.getByRole('combobox', { name: 'City' }).element())
    expect(style.paddingLeft).toBe(`${direction === 'ltr' ? start : end}px`)
    expect(style.paddingRight).toBe(`${direction === 'ltr' ? end : start}px`)
  })
})
