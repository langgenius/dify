import * as React from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { Dialog, DialogContent, DialogTitle } from '../../../dialog'
import { DirectionProvider } from '../../../direction-provider'
import { Field, FieldLabel } from '../../../field'
import {
  TimePicker,
  TimePickerContent,
  TimePickerLabel,
  TimePickerTrigger,
  TimePickerValue,
} from '../index'

it('allows a valid time to be reached through temporarily unavailable combinations', async () => {
  const changed = vi.fn()
  const screen = await render(
    <TimePicker
      defaultValue="09:30"
      onValueChange={changed}
      isTimeUnavailable={(time) => !['09:30', '10:00'].includes(time)}
    >
      <TimePickerLabel className="sr-only">Time</TimePickerLabel>
      <TimePickerTrigger />
      <TimePickerContent />
    </TimePicker>,
  )
  await screen.getByRole('button', { name: 'Time 9:30 AM' }).click()
  await screen
    .getByRole('listbox', { name: 'Hour' })
    .getByRole('option', { name: '10', exact: true })
    .click()
  await expect.element(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
  await screen
    .getByRole('listbox', { name: 'Minute' })
    .getByRole('option', { name: '00', exact: true })
    .click()
  await screen.getByRole('button', { name: 'OK' }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('10:00')
})

it('starts a fresh draft when controlled open changes without an open request', async () => {
  const changed = vi.fn()
  const view = (open: boolean, value: string) => (
    <TimePicker value={value} open={open} onValueChange={changed}>
      <TimePickerLabel className="sr-only">Time</TimePickerLabel>
      <TimePickerTrigger />
      <TimePickerContent />
    </TimePicker>
  )
  const screen = await render(view(true, '13:30'))
  await screen
    .getByRole('listbox', { name: 'Hour' })
    .getByRole('option', { name: '2', exact: true })
    .click()
  await screen.rerender(view(false, '13:30'))
  await screen.rerender(view(true, '09:45'))
  await expect
    .element(
      screen.getByRole('listbox', { name: 'Hour' }).getByRole('option', { name: '9', exact: true }),
    )
    .toHaveAttribute('aria-selected', 'true')
  await screen.getByRole('button', { name: 'OK' }).click()
  expect(changed).not.toHaveBeenCalled()
})

it('honors canceled close requests without discarding the active draft', async () => {
  const changed = vi.fn()
  const screen = await render(
    <TimePicker
      defaultValue="13:30"
      onValueChange={changed}
      onOpenChange={(open, details) => {
        if (!open && details.reason === 'escape-key') details.cancel()
      }}
    >
      <TimePickerLabel className="sr-only">Time</TimePickerLabel>
      <TimePickerTrigger />
      <TimePickerContent />
    </TimePicker>,
  )
  await screen.getByRole('button', { name: 'Time 1:30 PM' }).click()
  await screen
    .getByRole('listbox', { name: 'Hour' })
    .getByRole('option', { name: '2', exact: true })
    .click()
  await userEvent.keyboard('{Escape}')
  await expect
    .element(screen.getByRole('dialog', { name: 'Time', exact: true }))
    .toBeInTheDocument()
  await screen.getByRole('button', { name: 'OK' }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('14:30')
})

it('supports 24-hour navigation and numeric minute locating', async () => {
  const changed = vi.fn()
  const screen = await render(
    <TimePicker hourCycle={24} defaultValue="13:30" onValueChange={changed}>
      <TimePickerLabel className="sr-only">Time</TimePickerLabel>
      <TimePickerTrigger />
      <TimePickerContent />
    </TimePicker>,
  )
  await screen.getByRole('button', { name: 'Time 13:30' }).click()
  await userEvent.keyboard('{End}')
  await userEvent.tab()
  await userEvent.keyboard('45')
  await screen.getByRole('button', { name: 'OK' }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('23:45')
})

it('isolates draft option names and values from an enclosing field', async () => {
  const screen = await render(
    <form id="time-form">
      <Field name="appointment">
        <FieldLabel>Appointment</FieldLabel>
        <TimePicker name="appointment" defaultValue="13:30">
          <TimePickerLabel className="sr-only">Appointment</TimePickerLabel>
          <TimePickerTrigger />
          <TimePickerContent />
        </TimePicker>
      </Field>
    </form>,
  )
  await screen.getByRole('button', { name: 'Appointment 1:30 PM' }).click()
  await screen
    .getByRole('listbox', { name: 'Hour' })
    .getByRole('option', { name: '2', exact: true })
    .click()
  expect([
    ...new FormData(document.querySelector<HTMLFormElement>('#time-form')!).entries(),
  ]).toEqual([['appointment', '13:30']])
  const ids = [...document.querySelectorAll('[role="option"]')].map((element) => element.id)
  expect(new Set(ids).size).toBe(ids.length)
  await screen.getByRole('button', { name: 'OK' }).click()
  expect(
    new FormData(document.querySelector<HTMLFormElement>('#time-form')!).get('appointment'),
  ).toBe('14:30')
})

it('repositions all time columns when Now is clicked again without committing', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2025-01-15T13:30:00Z').getTime())
  const changed = vi.fn()
  const screen = await render(
    <TimePicker timeZone="UTC" defaultValue="13:30" onValueChange={changed}>
      <TimePickerLabel className="sr-only">Time</TimePickerLabel>
      <TimePickerTrigger />
      <TimePickerContent />
    </TimePicker>,
  )
  await screen.getByRole('button', { name: 'Time 1:30 PM' }).click()
  const column = screen.getByRole('listbox', { name: 'Minute' }).element()
  const selected = screen
    .getByRole('listbox', { name: 'Minute' })
    .getByRole('option', { name: '30', exact: true })
    .element() as HTMLElement
  await expect.poll(() => column.scrollTop).toBe(selected.offsetTop)
  column.scrollTo({ top: 0, behavior: 'instant' })
  await expect.poll(() => column.scrollTop).toBe(0)
  expect(changed).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: 'Now', exact: true }).click()
  await expect.poll(() => column.scrollTop).toBe(selected.offsetTop)
  await expect.element(screen.getByRole('button', { name: 'Now', exact: true })).toHaveFocus()
  expect(changed).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

it('keeps a quarter-hour field reachable and rounds Now down to its current interval', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2025-01-15T13:37:00Z').getTime())
  const changed = vi.fn()
  const screen = await render(
    <TimePicker timeZone="UTC" minuteStep={15} defaultValue="09:00" onValueChange={changed}>
      <TimePickerLabel className="sr-only">Time</TimePickerLabel>
      <TimePickerTrigger />
      <TimePickerContent />
    </TimePicker>,
  )
  await screen.getByRole('button', { name: 'Time 9:00 AM' }).click()
  expect(
    screen.getByRole('listbox', { name: 'Minute' }).element().querySelectorAll('[role="option"]'),
  ).toHaveLength(4)
  await screen.getByRole('button', { name: 'Now', exact: true }).click()
  expect(changed).not.toHaveBeenCalled()
  await expect
    .element(screen.getByRole('listbox', { name: 'Minute' }).getByRole('option', { name: '30' }))
    .toHaveAttribute('aria-selected', 'true')
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('13:30')
  vi.restoreAllMocks()
})

it('discards a draft when Tab leaves the nonmodal picker inside a modal dialog', async () => {
  const changed = vi.fn()
  const screen = await render(
    <Dialog defaultOpen>
      <DialogContent>
        <DialogTitle>Settings</DialogTitle>
        <TimePicker defaultValue="13:30" onValueChange={changed}>
          <TimePickerLabel className="sr-only">Time</TimePickerLabel>
          <TimePickerTrigger />
          <TimePickerContent />
        </TimePicker>
        <button type="button">Save settings</button>
      </DialogContent>
    </Dialog>,
  )
  await screen.getByRole('button', { name: 'Time 1:30 PM' }).click()
  await userEvent.keyboard('{ArrowDown}')
  await userEvent.tab()
  await userEvent.tab()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'Now', exact: true })).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'OK', exact: true })).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'Save settings' })).toHaveFocus()
  await expect
    .element(screen.getByRole('dialog', { name: 'Time', exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('dialog', { name: 'Settings', exact: true }))
    .toBeInTheDocument()
  expect(changed).not.toHaveBeenCalled()
})

it('aligns pointer selections and immediately positions keyboard selections at the same top anchor', async () => {
  const screen = await render(
    <TimePicker defaultValue="13:30">
      <TimePickerLabel className="sr-only">Time</TimePickerLabel>
      <TimePickerTrigger />
      <TimePickerContent />
    </TimePicker>,
  )
  await screen.getByRole('button', { name: 'Time 1:30 PM' }).click()
  const hours = screen.getByRole('listbox', { name: 'Hour' })
  const column = hours.element()
  expect(column.scrollTop).toBe(0)
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(hours.getByRole('option', { name: '2', exact: true })).toHaveFocus()
  expect(column.scrollTop).toBe(26)
  // Disable Playwright's retry alignment so the test measures the component's scrolling.
  await hours.getByRole('option', { name: '3', exact: true }).click({ scroll: 'none' })
  await expect.poll(() => column.scrollTop).toBe(52)
  await userEvent.keyboard('12')
  const last = hours.getByRole('option', { name: '12', exact: true }).element() as HTMLElement
  await expect.element(last).toHaveFocus()
  expect(column.scrollTop).toBe(last.offsetTop)
  await userEvent.keyboard('{Home}')
  expect(column.scrollTop).toBe(0)
  await userEvent.keyboard('{PageDown}')
  await expect.element(hours.getByRole('option', { name: '6', exact: true })).toHaveFocus()
  await userEvent.keyboard('{End}{ArrowDown}')
  await expect.element(last).toHaveFocus()
})

it('preserves draft selection after focus leaves and does not select hovered options', async () => {
  const changed = vi.fn()
  const screen = await render(
    <DirectionProvider direction="rtl">
      <TimePicker defaultValue="13:30" onValueChange={changed}>
        <TimePickerLabel className="sr-only">Time</TimePickerLabel>
        <TimePickerTrigger />
        <TimePickerContent />
      </TimePicker>
    </DirectionProvider>,
  )
  await screen.getByRole('button', { name: 'Time 1:30 PM' }).click()
  await expect
    .element(screen.getByRole('dialog', { name: 'Time', exact: true }))
    .toHaveAttribute('dir', 'rtl')
  const hours = screen.getByRole('listbox', { name: 'Hour' })
  const minutes = screen.getByRole('listbox', { name: 'Minute' })
  expect(hours.element().getBoundingClientRect().left).toBeGreaterThan(
    minutes.element().getBoundingClientRect().left,
  )
  await userEvent.keyboard('{ArrowDown}')
  const selectedHour = hours.getByRole('option', { name: '2', exact: true })
  await expect.element(selectedHour).toHaveFocus()
  await expect.element(selectedHour).toHaveAttribute('aria-selected', 'true')
  await userEvent.tab()
  await expect.element(minutes.getByRole('option', { name: '30', exact: true })).toHaveFocus()
  await hours.getByRole('option', { name: '3', exact: true }).hover({ scroll: 'none' })
  await expect.element(selectedHour).toHaveAttribute('aria-selected', 'true')
  await expect
    .element(hours.getByRole('option', { name: '3', exact: true }))
    .toHaveAttribute('aria-selected', 'false')
  expect(changed).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('14:30')
})

it('announces the complete custom displayed value including its timezone', async () => {
  const screen = await render(
    <TimePicker defaultValue="13:30">
      <TimePickerLabel className="sr-only">Time</TimePickerLabel>
      <TimePickerTrigger>
        <TimePickerValue>
          {(displayValue) => (
            <React.Fragment>
              <span>{displayValue}</span> <span>UTC+08:00</span>
            </React.Fragment>
          )}
        </TimePickerValue>
      </TimePickerTrigger>
      <TimePickerContent />
    </TimePicker>,
  )
  await expect
    .element(screen.getByRole('button', { name: 'Time 1:30 PM UTC+08:00', exact: true }))
    .toBeVisible()
})
