import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { DatePicker, DatePickerContent, DatePickerLabel, DatePickerTrigger } from '../date-picker'
import { TimePicker, TimePickerContent, TimePickerLabel, TimePickerTrigger } from '../time-picker'

async function openMonthPicker() {
  const changed = vi.fn()
  const screen = await render(
    <DatePicker defaultValue="2025-01-15" onValueChange={changed}>
      <DatePickerLabel className="sr-only">Date</DatePickerLabel>
      <DatePickerTrigger />
      <DatePickerContent />
    </DatePicker>,
  )
  await screen.getByRole('button', { name: 'Date Jan 15, 2025' }).click()
  await screen.getByRole('button', { name: /Choose month and year:/ }).click()
  const months = screen.getByRole('listbox', { name: 'Month', exact: true })
  await expect.element(months.getByRole('option', { name: 'January' })).toHaveFocus()
  return { screen, months, changed }
}

it('keeps a multi-letter month match anchored and recovers immediately after a typo', async () => {
  const { months, changed } = await openMonthPicker()
  await userEvent.keyboard('j')
  await expect.element(months.getByRole('option', { name: 'June' })).toHaveFocus()
  await userEvent.keyboard('u')
  await expect.element(months.getByRole('option', { name: 'June' })).toHaveFocus()
  await userEvent.keyboard('n')
  await expect.element(months.getByRole('option', { name: 'June' })).toHaveFocus()
  await userEvent.keyboard('z')
  await expect.element(months.getByRole('option', { name: 'June' })).toHaveFocus()
  await userEvent.keyboard('mar')
  const march = months.getByRole('option', { name: 'March' })
  await expect.element(march).toHaveFocus()
  await expect.element(march).toHaveAttribute('aria-selected', 'true')
  expect(changed).not.toHaveBeenCalled()
})

it('cycles matching months on repeated letters regardless of letter case', async () => {
  const { months, changed } = await openMonthPicker()
  for (const [key, name] of [
    ['j', 'June'],
    ['J', 'July'],
    ['j', 'January'],
  ] as const) {
    await userEvent.keyboard(key)
    const option = months.getByRole('option', { name })
    await expect.element(option).toHaveFocus()
    await expect.element(option).toHaveAttribute('aria-selected', 'true')
  }
  expect(changed).not.toHaveBeenCalled()
})

it('clears an unfinished year prefix when Tab leaves the column', async () => {
  const { screen, changed } = await openMonthPicker()
  await userEvent.tab()
  const years = screen.getByRole('listbox', { name: 'Year', exact: true })
  await userEvent.keyboard('20')
  await expect.element(years.getByRole('option', { name: '2025' })).toHaveFocus()
  await userEvent.tab({ shift: true })
  await userEvent.tab()
  await userEvent.keyboard('2037')
  await expect.element(years.getByRole('option', { name: '2037' })).toHaveFocus()
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  await expect
    .element(screen.getByRole('button', { name: 'Choose month and year: January 2037' }))
    .toBeInTheDocument()
  expect(changed).not.toHaveBeenCalled()
})

it('preserves repeated digits and starts fresh after returning to a time column', async () => {
  const changed = vi.fn()
  const screen = await render(
    <TimePicker defaultValue="13:30" onValueChange={changed}>
      <TimePickerLabel className="sr-only">Time</TimePickerLabel>
      <TimePickerTrigger />
      <TimePickerContent />
    </TimePicker>,
  )
  const trigger = screen.getByRole('button', { name: 'Time 1:30 PM' })
  await trigger.click()
  const hours = screen.getByRole('listbox', { name: 'Hour', exact: true })
  await userEvent.keyboard('11')
  await expect.element(hours.getByRole('option', { name: '11', exact: true })).toHaveFocus()
  await userEvent.tab()
  await userEvent.keyboard('55')
  await expect
    .element(screen.getByRole('listbox', { name: 'Minute' }).getByRole('option', { name: '55' }))
    .toHaveFocus()
  await userEvent.tab({ shift: true })
  await userEvent.keyboard('2')
  await expect.element(hours.getByRole('option', { name: '2', exact: true })).toHaveFocus()
  expect(changed).not.toHaveBeenCalled()
  await expect.element(trigger).toHaveTextContent('1:30 PM')
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('14:55')
})
