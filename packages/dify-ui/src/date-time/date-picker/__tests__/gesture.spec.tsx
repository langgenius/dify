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

// Synthetic intent with real Chromium scrolling, matching the time-column gesture tests.
function startTouch(column: Element, top: number) {
  column.dispatchEvent(new Event('touchstart'))
  column.scrollTo({ top, behavior: 'instant' })
  column.dispatchEvent(new Event('scroll'))
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
  startTouch(months.element(), 136)
  startTouch(years.element(), 188)
  await expect
    .element(months.getByRole('option', { name: 'June' }))
    .toHaveAttribute('aria-selected', 'true')
  await expect
    .element(years.getByRole('option', { name: '2027' }))
    .toHaveAttribute('aria-selected', 'true')
  expect(months.element().scrollTop).toBe(136)
  expect(years.element().scrollTop).toBe(188)
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
  startTouch(months.element(), 136)
  startTouch(years.element(), 188)
  for (const column of [months.element(), years.element()]) {
    column.dispatchEvent(new Event('touchend'))
    column.dispatchEvent(new Event('scrollend'))
  }
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
