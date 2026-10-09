import { arTN } from '@daypicker/react/locale/ar-TN'
import { enUS } from '@daypicker/react/locale/en-US'
import { faIR } from '@daypicker/react/locale/fa-IR'
import { zhCN } from '@daypicker/react/locale/zh-CN'
import * as React from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { DatePicker, DatePickerContent, DatePickerLabel, DatePickerTrigger } from '../date-picker'
import {
  DateTimePicker,
  DateTimePickerContent,
  DateTimePickerLabel,
  DateTimePickerTrigger,
} from '../date-time-picker'
import { TimePicker, TimePickerContent, TimePickerLabel, TimePickerTrigger } from '../time-picker'

// Vitest's Playwright provider inserts non-US text without keydown; these dispatches test
// the localized KeyboardEvent contract, not an installed Persian keyboard layout.
async function typeNativeDigits(text: string) {
  for (const key of text) {
    await React.act(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      )
    })
  }
}

it.each([
  [enUS, '15', '2025', '10', '05'],
  [zhCN, '15', '2025', '10', '05'],
  [arTN, '15', '2025', '10', '05'],
  [faIR, '۱۵', '۲۰۲۵', '۱۰', '۰۵'],
] as const)(
  'uses consistent numerals across date, year and time views for $0.code',
  async (locale, day, year, hour, minute) => {
    const screen = await render(
      <DateTimePicker
        locale={locale}
        timeZone="UTC"
        hourCycle={24}
        defaultValue={new Date('2025-01-15T10:05:00Z')}
      >
        <DateTimePickerLabel className="sr-only">Meeting</DateTimePickerLabel>
        <DateTimePickerTrigger />
        <DateTimePickerContent />
      </DateTimePicker>,
    )
    const trigger = screen.getByRole('button', { name: /^Meeting / })
    await expect.element(trigger).toMatchTextContent(`${hour}:${minute}`)
    await trigger.click()
    await expect.element(screen.getByRole('gridcell', { selected: true })).toHaveTextContent(day)
    await screen.getByRole('button', { name: /Choose month and year:/ }).click()
    await expect
      .element(screen.getByRole('listbox', { name: 'Year' }).getByRole('option', { name: year }))
      .toHaveAttribute('aria-selected', 'true')
    await screen.getByRole('button', { name: 'Cancel', exact: true }).click()
    await screen.getByRole('button', { name: /Pick Time:/ }).click()
    await expect
      .element(screen.getByRole('listbox', { name: 'Hour' }).getByRole('option', { name: hour }))
      .toHaveAttribute('aria-selected', 'true')
    await expect
      .element(
        screen.getByRole('listbox', { name: 'Minute' }).getByRole('option', { name: minute }),
      )
      .toHaveAttribute('aria-selected', 'true')
  },
)

it('locates Persian month/year numbers while preserving canonical civil-date submission', async () => {
  const changed = vi.fn()
  const screen = await render(
    <form aria-label="Booking">
      <DatePicker locale={faIR} name="date" defaultValue="2025-01-15" onValueChange={changed}>
        <DatePickerLabel className="sr-only">Date</DatePickerLabel>
        <DatePickerTrigger />
        <DatePickerContent />
      </DatePicker>
    </form>,
  )
  await screen.getByRole('button', { name: /^Date / }).click()
  await screen.getByRole('button', { name: /Choose month and year:/ }).click()
  await typeNativeDigits('۱۲')
  await expect
    .element(screen.getByRole('listbox', { name: 'Month' }).getByRole('option', { name: 'دسامبر' }))
    .toHaveFocus()
  await userEvent.tab()
  await typeNativeDigits('۲۰۲۶')
  const year = screen.getByRole('option', { name: '۲۰۲۶', exact: true })
  await expect.element(year).toHaveFocus()
  await userEvent.keyboard('{Home}2026')
  await expect.element(year).toHaveFocus()
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  expect(changed).not.toHaveBeenCalled()
  await screen.getByRole('grid').getByRole('button', { name: /۱۵/ }).click()
  expect(changed).toHaveBeenCalledWith('2026-12-15')
  expect(
    new FormData(screen.getByRole('form', { name: 'Booking' }).element() as HTMLFormElement).get(
      'date',
    ),
  ).toBe('2026-12-15')
})

it('updates an open locale without committing or discarding the time draft and clears the locating buffer', async () => {
  const changed = vi.fn()
  const view = (locale: string) => (
    <form aria-label="Schedule">
      <TimePicker
        locale={locale}
        hourCycle={24}
        name="time"
        defaultValue="10:05"
        onValueChange={changed}
      >
        <TimePickerLabel className="sr-only">Time</TimePickerLabel>
        <TimePickerTrigger />
        <TimePickerContent />
      </TimePicker>
    </form>
  )
  const screen = await render(view('en-US'))
  await screen.getByRole('button', { name: 'Time 10:05' }).click()
  await userEvent.keyboard('1')
  await screen.rerender(view('fa-IR'))
  await expect
    .element(
      screen.getByRole('listbox', { name: 'Hour' }).getByRole('option', { name: '۱', exact: true }),
    )
    .toHaveFocus()
  await typeNativeDigits('۲')
  await expect
    .element(
      screen.getByRole('listbox', { name: 'Hour' }).getByRole('option', { name: '۲', exact: true }),
    )
    .toHaveFocus()
  expect(changed).not.toHaveBeenCalled()
  await userEvent.keyboard('{Escape}')
  await screen.getByRole('button', { name: 'Time ۱۰:۰۵' }).click()
  await expect
    .element(screen.getByRole('listbox', { name: 'Hour' }).getByRole('option', { name: '۱۰' }))
    .toHaveAttribute('aria-selected', 'true')
  await userEvent.tab()
  await typeNativeDigits('۱۲')
  const minute = screen.getByRole('listbox', { name: 'Minute' }).getByRole('option', { name: '۱۲' })
  await expect.element(minute).toHaveFocus()
  await userEvent.keyboard('{Home}12')
  await expect.element(minute).toHaveFocus()
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('10:12')
  expect(
    new FormData(screen.getByRole('form', { name: 'Schedule' }).element() as HTMLFormElement).get(
      'time',
    ),
  ).toBe('10:12')
})
