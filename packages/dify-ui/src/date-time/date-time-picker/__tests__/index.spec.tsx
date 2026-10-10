import * as React from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  DateTimePicker,
  DateTimePickerContent,
  DateTimePickerLabel,
  DateTimePickerTrigger,
} from '../index'

it('keeps the natural calendar and month-picker height around a centered mobile trigger', async () => {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  await page.viewport(390, 640)
  try {
    const screen = await render(
      <div style={{ position: 'fixed', top: 318, left: 40 }}>
        <DateTimePicker timeZone="UTC" defaultValue={new Date('2025-01-15T13:30:00Z')}>
          <DateTimePickerLabel className="sr-only">Meeting</DateTimePickerLabel>
          <DateTimePickerTrigger />
          <DateTimePickerContent />
        </DateTimePicker>
      </div>,
    )
    const trigger = screen.getByRole('button', { name: /^Meeting / })
    await trigger.click()
    const popup = screen.getByRole('dialog', { name: 'Meeting', exact: true }).element()
    await expect.poll(() => popup.getBoundingClientRect().height).toBe(292)
    function expectVisiblePanel() {
      const bounds = popup.getBoundingClientRect()
      expect(bounds.top).toBeGreaterThanOrEqual(0)
      expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight)
      const anchor = trigger.element().getBoundingClientRect()
      expect(bounds.bottom <= anchor.top - 8 || bounds.top >= anchor.bottom + 8).toBe(true)
      expect(popup.scrollHeight).toBe(popup.clientHeight)
      const apply = screen
        .getByRole('button', { name: 'OK', exact: true })
        .element()
        .getBoundingClientRect()
      expect(apply.bottom).toBeLessThanOrEqual(bounds.bottom)
    }
    expectVisiblePanel()
    for (const element of popup.querySelectorAll<HTMLElement>('*')) {
      if (getComputedStyle(element).overflowY === 'auto')
        expect(element.scrollHeight).toBe(element.clientHeight)
    }
    await screen.getByRole('button', { name: /Choose month and year:/ }).click()
    expect(popup.getBoundingClientRect().height).toBe(292)
    expectVisiblePanel()
    expect(screen.getByRole('listbox', { name: 'Month' }).element().clientHeight).toBe(192)
    await screen.getByRole('button', { name: /Choose month and year:/ }).click()
    await screen.getByRole('button', { name: /Pick Time:/ }).click()
    expectVisiblePanel()
    expect(screen.getByRole('listbox', { name: 'Hour' }).element().clientHeight).toBe(192)
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('button', { name: /^Meeting / })).toHaveFocus()
  } finally {
    await page.viewport(viewport.width, viewport.height)
  }
})

it.each([
  ['Tuesday, December 31st, 2024', 'December 2024', '2024-12-31'],
  ['Saturday, February 1st, 2025', 'February 2025', '2025-02-01'],
])('navigates to %s on selection and commits only on OK', async (day, month, date) => {
  const changed = vi.fn()
  const screen = await render(
    <DateTimePicker
      timeZone="UTC"
      defaultValue={new Date('2025-01-15T13:30:00Z')}
      onValueChange={changed}
    >
      <DateTimePickerLabel className="sr-only">Meeting</DateTimePickerLabel>
      <DateTimePickerTrigger />
      <DateTimePickerContent />
    </DateTimePicker>,
  )
  const trigger = screen.getByRole('button', { name: 'Meeting Jan 15, 2025, 1:30 PM' })
  await trigger.click()
  await screen.getByRole('button', { name: day, exact: true }).click()
  await expect.element(screen.getByRole('grid', { name: month })).toBeInTheDocument()
  await expect.element(screen.getByRole('status')).toHaveTextContent(month)
  await expect.element(screen.getByRole('button', { name: `${day}, selected` })).toHaveFocus()
  await expect.element(trigger).toBeInTheDocument()
  expect(changed).not.toHaveBeenCalled()
  await userEvent.keyboard('{Escape}')
  await expect.element(trigger).toHaveFocus()
  await trigger.click()
  await expect.element(screen.getByRole('grid', { name: 'January 2025' })).toBeInTheDocument()
  await screen.getByRole('button', { name: day, exact: true }).click()
  await screen.getByRole('button', { name: 'OK' }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith(new Date(`${date}T13:30:00Z`))
})

it.each([
  ['2026-02-15', 258],
  ['2025-01-15', 292],
  ['2025-03-15', 326],
] as const)(
  'preserves the %s calendar height when toggling month selection',
  async (date, height) => {
    const screen = await render(
      <DateTimePicker timeZone="UTC" defaultValue={new Date(`${date}T13:30:00Z`)}>
        <DateTimePickerLabel className="sr-only">Meeting</DateTimePickerLabel>
        <DateTimePickerTrigger />
        <DateTimePickerContent />
      </DateTimePicker>,
    )
    await screen.getByRole('button', { name: /^Meeting / }).click()
    const popup = screen.getByRole('dialog', { name: 'Meeting', exact: true }).element()
    await expect.poll(() => popup.getBoundingClientRect().height).toBe(height)
    await screen.getByRole('button', { name: /Choose month and year:/ }).click()
    expect(popup.getBoundingClientRect().height).toBe(height)
    expect(popup.scrollHeight).toBe(popup.clientHeight)
    const footer = screen.getByRole('button', { name: 'OK' }).element().getBoundingClientRect()
    expect(footer.bottom).toBeLessThanOrEqual(popup.getBoundingClientRect().bottom)
    await screen.getByRole('button', { name: /Choose month and year:/ }).click()
    await expect.element(screen.getByRole('grid')).toBeInTheDocument()
    expect(popup.getBoundingClientRect().height).toBe(height)
  },
)

it.each(['ltr', 'rtl'] as const)(
  'keeps focused time options visible after switching a height-limited %s popup',
  async (direction) => {
    const screen = await render(
      <DateTimePicker
        direction={direction}
        timeZone="UTC"
        defaultValue={new Date('2025-01-15T13:30:00Z')}
      >
        <DateTimePickerLabel className="sr-only">Meeting</DateTimePickerLabel>
        <DateTimePickerTrigger />
        <DateTimePickerContent style={{ maxHeight: 210 }} />
      </DateTimePicker>,
    )
    await screen.getByRole('button', { name: /^Meeting / }).click()
    const calendarPopup = screen.getByRole('dialog', { name: 'Meeting', exact: true }).element()
    await expect.poll(() => calendarPopup.getBoundingClientRect().height).toBe(210)
    const calendarHeight = calendarPopup.getBoundingClientRect().height
    await screen.getByRole('button', { name: /Choose month and year:/ }).click()
    expect(calendarPopup.getBoundingClientRect().height).toBe(calendarHeight)
    await screen.getByRole('button', { name: /Choose month and year:/ }).click()
    await screen.getByRole('button', { name: /Pick Time:/ }).click()
    const hours = screen.getByRole('listbox', { name: 'Hour' })
    const first = hours.getByRole('option', { name: '1', exact: true })
    await expect.element(first).toHaveFocus()
    const popup = screen.getByRole('dialog', { name: 'Meeting', exact: true })
    function fullyVisible(element: Element) {
      const bounds = popup.element().getBoundingClientRect()
      const option = element.getBoundingClientRect()
      return option.top >= bounds.top && option.bottom <= bounds.bottom
    }
    await expect.poll(() => fullyVisible(first.element())).toBe(true)
    expect(fullyVisible(screen.getByRole('button', { name: 'Now', exact: true }).element())).toBe(
      true,
    )
    expect(fullyVisible(screen.getByRole('button', { name: 'OK', exact: true }).element())).toBe(
      true,
    )
    expect(popup.element().scrollHeight).toBe(popup.element().clientHeight)
    expect(hours.element().clientHeight).toBeLessThan(192)
    await userEvent.keyboard('{End}')
    const last = hours.getByRole('option', { name: '12', exact: true })
    await expect.element(last).toHaveFocus()
    await expect.poll(() => fullyVisible(last.element())).toBe(true)
    expect(hours.element().scrollTop).toBe((last.element() as HTMLElement).offsetTop)
  },
)

describe('DateTimePicker', () => {
  it('discards a draft on Escape and leaves the existing instant unchanged on OK', async () => {
    const original = new Date('2024-11-03T06:30:00.000Z')
    const onValueChange = vi.fn()
    const screen = await render(
      <DateTimePicker timeZone="America/New_York" value={original} onValueChange={onValueChange}>
        <DateTimePickerLabel className="sr-only">Meeting time</DateTimePickerLabel>
        <DateTimePickerTrigger />
        <DateTimePickerContent />
      </DateTimePicker>,
    )

    await screen.getByRole('button', { name: /Meeting time / }).click()
    await expect.element(screen.getByRole('grid')).toBeInTheDocument()
    await screen.getByRole('button', { name: /Pick Time:/ }).click()
    await expect.element(screen.getByRole('listbox', { name: 'Hour' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(onValueChange).not.toHaveBeenCalled()

    await screen.getByRole('button', { name: /Meeting time / }).click()
    await screen.getByRole('button', { name: /Pick Time:/ }).click()
    await screen.getByRole('button', { name: 'OK' }).click()
    expect(onValueChange).not.toHaveBeenCalled()
  })
})

it('rejects a daylight-saving gap and lets the user repair it before committing', async () => {
  const changed = vi.fn()
  const screen = await render(
    <DateTimePicker
      timeZone="America/New_York"
      defaultValue={new Date('2025-03-09T06:30:00Z')}
      onValueChange={changed}
    >
      <DateTimePickerLabel className="sr-only">Meeting</DateTimePickerLabel>
      <DateTimePickerTrigger />
      <DateTimePickerContent />
    </DateTimePicker>,
  )
  await screen.getByRole('button', { name: /^Meeting / }).click()
  await screen.getByRole('button', { name: /Pick Time:/ }).click()
  await screen
    .getByRole('listbox', { name: 'Hour' })
    .getByRole('option', { name: '2', exact: true })
    .click()
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('This date or time is unavailable.')
  await expect.element(screen.getByRole('button', { name: 'OK', exact: true })).toBeDisabled()
  expect(changed).not.toHaveBeenCalled()
  await screen
    .getByRole('listbox', { name: 'Hour' })
    .getByRole('option', { name: '3', exact: true })
    .click()
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  expect(changed.mock.calls[0]?.[0].toISOString()).toBe('2025-03-09T07:30:00.000Z')
})

it.each([
  ['Asia/Shanghai', '10:23 PM'],
  ['America/New_York', '10:23 AM'],
])(
  'keeps Now in the draft and commits the current instant in %s',
  async (timeZone, displayTime) => {
    vi.setSystemTime(new Date('2026-09-28T14:23:00Z'))
    try {
      const changed = vi.fn()
      const screen = await render(
        <DateTimePicker
          timeZone={timeZone}
          defaultValue={new Date('2025-01-15T13:30:00Z')}
          onValueChange={changed}
        >
          <DateTimePickerLabel className="sr-only">Meeting</DateTimePickerLabel>
          <DateTimePickerTrigger />
          <DateTimePickerContent />
        </DateTimePicker>,
      )
      await screen.getByRole('button', { name: /^Meeting / }).click()
      await screen.getByRole('button', { name: 'Now' }).click()
      await expect
        .element(screen.getByRole('button', { name: `Pick Time: ${displayTime}` }))
        .toBeInTheDocument()
      expect(changed).not.toHaveBeenCalled()
      await screen.getByRole('button', { name: 'OK' }).click()
      expect(changed).toHaveBeenCalledExactlyOnceWith(new Date('2026-09-28T14:23:00Z'))
      await expect
        .element(screen.getByRole('button', { name: `Meeting Sep 28, 2026, ${displayTime}` }))
        .toHaveFocus()
    } finally {
      vi.useRealTimers()
    }
  },
)
