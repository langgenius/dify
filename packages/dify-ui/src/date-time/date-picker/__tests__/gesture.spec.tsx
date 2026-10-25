import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { DatePicker, DatePickerContent, DatePickerLabel, DatePickerTrigger } from '../index'

async function openMonths() {
  const changed = vi.fn()
  const screen = await render(
    <DatePicker
      defaultValue="2025-01-15"
      minDate="2020-01-01"
      maxDate="2030-12-31"
      onValueChange={changed}
    >
      <DatePickerLabel className="sr-only">Date</DatePickerLabel>
      <DatePickerTrigger />
      <DatePickerContent style={{ maxHeight: 210 }} />
    </DatePicker>,
  )
  await screen.getByRole('button', { name: 'Date Jan 15, 2025' }).click()
  await screen.getByRole('button', { name: /Choose month and year:/ }).click()
  const months = screen.getByRole('listbox', { name: 'Month' })
  const years = screen.getByRole('listbox', { name: 'Year' })
  await expect.element(months.getByRole('option', { name: 'January' })).toHaveFocus()
  return { screen, months, years, changed }
}

// Any scroll the column did not start is a selection, matching the time-column scroll tests.
function scrollColumn(column: Element, top: number) {
  column.scrollTo({ top, behavior: 'instant' })
}

it('shares top alignment across click, keyboard and touch and applies both moving month/year columns', async () => {
  const { screen, months, years, changed } = await openMonths()
  const popup = screen.getByRole('dialog', { name: 'Date', exact: true }).element()
  const bounds = popup.getBoundingClientRect()
  const apply = screen.getByRole('button', { name: 'OK', exact: true })
  const cancel = screen.getByRole('button', { name: 'Cancel', exact: true })
  for (const button of [apply, cancel]) {
    const rect = button.element().getBoundingClientRect()
    expect(rect.top).toBeGreaterThanOrEqual(bounds.top)
    expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom)
  }
  expect(popup.scrollHeight).toBe(popup.clientHeight)
  expect(months.element().clientHeight).toBeLessThan(192)
  await months.getByRole('option', { name: 'April' }).click({ scroll: 'none' })
  await expect.poll(() => months.element().scrollTop).toBe(78)
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(months.getByRole('option', { name: 'May' })).toHaveFocus()
  expect(months.element().scrollTop).toBe(104)
  scrollColumn(months.element(), 136)
  scrollColumn(years.element(), 188)
  await expect
    .element(months.getByRole('option', { name: 'June' }))
    .toHaveAttribute('aria-selected', 'true')
  await expect
    .element(years.getByRole('option', { name: '2027' }))
    .toHaveAttribute('aria-selected', 'true')
  expect(months.element().scrollTop).toBe(130)
  expect(years.element().scrollTop).toBe(182)
  await apply.click()
  await expect
    .element(screen.getByRole('button', { name: 'Choose month and year: June 2027' }))
    .toBeInTheDocument()
  expect(changed).not.toHaveBeenCalled()
  await expect
    .element(screen.getByRole('button', { name: 'Date Jan 15, 2025' }))
    .toBeInTheDocument()
})

it('settles month gestures without losing a concurrent year draft and cancels them without applying', async () => {
  const { screen, months, years, changed } = await openMonths()
  scrollColumn(months.element(), 136)
  scrollColumn(years.element(), 188)
  await expect
    .element(months.getByRole('option', { name: 'June' }))
    .toHaveAttribute('aria-selected', 'true')
  await expect
    .element(years.getByRole('option', { name: '2027' }))
    .toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => months.element().scrollTop).toBe(130)
  await screen.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect
    .element(screen.getByRole('button', { name: 'Choose month and year: January 2025' }))
    .toHaveFocus()
  expect(changed).not.toHaveBeenCalled()
})

it('applies the highlighted year when OK is clicked while the column is still scrolling', async () => {
  const { screen, years } = await openMonths()
  const column = years.element()
  const ok = screen.getByRole('button', { name: 'OK', exact: true }).element() as HTMLElement
  column.scrollTo({ top: 0, behavior: 'smooth' })
  const seen = await new Promise<{ year: string; top: number }>((resolve) => {
    function frame() {
      const year = column.querySelector('[aria-selected="true"]')!.textContent
      if (year === '2025') return requestAnimationFrame(frame)
      const top = column.scrollTop
      ok.click()
      resolve({ year, top })
    }
    requestAnimationFrame(frame)
  })
  expect(seen.top).toBeGreaterThan(0)
  await expect
    .element(screen.getByRole('button', { name: `Choose month and year: January ${seen.year}` }))
    .toBeInTheDocument()
})
