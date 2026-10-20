import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { TimePicker, TimePickerContent, TimePickerLabel, TimePickerTrigger } from '../index'

async function renderPicker() {
  const changed = vi.fn()
  const screen = await render(
    <TimePicker defaultValue="13:30" timeZone="UTC" onValueChange={changed}>
      <TimePickerLabel className="sr-only">Time</TimePickerLabel>
      <TimePickerTrigger />
      <TimePickerContent />
    </TimePicker>,
  )
  await screen.getByRole('button', { name: 'Time 1:30 PM' }).click()
  const hours = screen.getByRole('listbox', { name: 'Hour' })
  await expect.element(hours.getByRole('option', { name: '1', exact: true })).toHaveFocus()
  return { screen, hours, column: hours.element(), changed }
}

// Any scroll the column did not start is a selection; Chromium snaps it to a row.
function scrollColumn(column: Element, top: number) {
  column.scrollTo({ top, behavior: 'instant' })
}

it('selects the row a scroll rests on, moves focus there and does not commit', async () => {
  const { screen, hours, column, changed } = await renderPicker()
  scrollColumn(column, 67)
  const fourth = hours.getByRole('option', { name: '4', exact: true })
  await expect.element(fourth).toHaveAttribute('aria-selected', 'true')
  await expect.element(fourth).toHaveFocus()
  expect(column.scrollTop).toBe(78)
  expect(changed).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('16:30')
})

it('keeps a clicked target selected throughout positioning after a scroll', async () => {
  const { screen, hours, column, changed } = await renderPicker()
  scrollColumn(column, 67)
  await expect
    .element(hours.getByRole('option', { name: '4', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  const target = hours.getByRole('option', { name: '6', exact: true })
  await target.click({ scroll: 'none' })
  await expect.element(target).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => column.scrollTop).toBe(130)
  await expect.element(target).toHaveAttribute('aria-selected', 'true')
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('18:30')
})

it('aligns AM and PM to the same top anchor for keyboard, click and scroll selection', async () => {
  const { screen, changed } = await renderPicker()
  const period = screen.getByRole('listbox', { name: 'Period' })
  const column = period.element()
  const am = period.getByRole('option', { name: 'AM' })
  const pm = period.getByRole('option', { name: 'PM' })
  expect(column.scrollTop).toBe(26)
  await pm.click({ scroll: 'none' })
  await userEvent.keyboard('{ArrowUp}')
  await expect.element(am).toHaveFocus()
  expect(column.scrollTop).toBe(0)
  await pm.click({ scroll: 'none' })
  await expect.poll(() => column.scrollTop).toBe(26)
  await expect.element(pm).toHaveAttribute('aria-selected', 'true')
  scrollColumn(column, 6)
  await expect.element(am).toHaveAttribute('aria-selected', 'true')
  expect(column.scrollTop).toBe(0)
  expect(changed).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('01:30')
})

it('applies both scrolled columns when OK is clicked', async () => {
  const { screen, column, changed } = await renderPicker()
  const minutes = screen.getByRole('listbox', { name: 'Minute' }).element()
  scrollColumn(column, 67)
  scrollColumn(minutes, 1050)
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('16:40')
})

it('continues keyboard navigation from the scrolled row', async () => {
  const { hours, column, changed } = await renderPicker()
  scrollColumn(column, 67)
  await expect
    .element(hours.getByRole('option', { name: '4', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await userEvent.keyboard('{ArrowDown}')
  const fifth = hours.getByRole('option', { name: '5', exact: true })
  await expect.element(fifth).toHaveFocus()
  await expect.poll(() => column.scrollTop).toBe(104)
  await expect.element(fifth).toHaveAttribute('aria-selected', 'true')
  expect(changed).not.toHaveBeenCalled()
})

it('lets Now override scrolled columns and keeps focus on Now', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2025-01-15T13:30:00Z').getTime())
  try {
    const { screen, hours, column, changed } = await renderPicker()
    scrollColumn(column, 67)
    await expect
      .element(hours.getByRole('option', { name: '4', exact: true }))
      .toHaveAttribute('aria-selected', 'true')
    await screen.getByRole('button', { name: 'Now', exact: true }).click()
    await expect.poll(() => column.scrollTop).toBe(0)
    await expect
      .element(hours.getByRole('option', { name: '1', exact: true }))
      .toHaveAttribute('aria-selected', 'true')
    await expect.element(screen.getByRole('button', { name: 'Now', exact: true })).toHaveFocus()
    expect(changed).not.toHaveBeenCalled()
  } finally {
    vi.restoreAllMocks()
  }
})

it('discards a scrolled draft on Escape', async () => {
  const { screen, hours, column, changed } = await renderPicker()
  scrollColumn(column, 67)
  await expect
    .element(hours.getByRole('option', { name: '4', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('button', { name: 'Time 1:30 PM' })).toHaveFocus()
  expect(changed).not.toHaveBeenCalled()
})

it('commits the highlighted row when OK is clicked while a column is still scrolling', async () => {
  const { screen, changed } = await renderPicker()
  const minutes = screen.getByRole('listbox', { name: 'Minute' }).element()
  const ok = screen.getByRole('button', { name: 'OK', exact: true }).element() as HTMLElement
  minutes.scrollTo({ top: 0, behavior: 'smooth' })
  const seen = await new Promise<{ minute: string; top: number }>((resolve) => {
    function frame() {
      const minute = minutes.querySelector('[aria-selected="true"]')!.textContent
      if (minute === '30') return requestAnimationFrame(frame)
      const top = minutes.scrollTop
      ok.click()
      resolve({ minute, top })
    }
    requestAnimationFrame(frame)
  })
  expect(seen.top).toBeGreaterThan(0)
  expect(changed).toHaveBeenCalledExactlyOnceWith(`13:${seen.minute}`)
})

it('settles through the quiet fallback when scrollend is unavailable', async () => {
  let owner: object | null = HTMLElement.prototype
  while (owner && !Object.hasOwn(owner, 'onscrollend')) owner = Object.getPrototypeOf(owner)
  expect(owner).not.toBeNull()
  const descriptor = Object.getOwnPropertyDescriptor(owner!, 'onscrollend')!
  Reflect.deleteProperty(owner!, 'onscrollend')
  try {
    const { hours, column } = await renderPicker()
    scrollColumn(column, 67)
    const fourth = hours.getByRole('option', { name: '4', exact: true })
    await expect.element(fourth).toHaveAttribute('aria-selected', 'true')
    await expect.element(fourth).toHaveFocus()
    expect(column.scrollTop).toBe(78)
  } finally {
    Object.defineProperty(owner!, 'onscrollend', descriptor)
  }
})
