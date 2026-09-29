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
  return { screen, hours, column: hours.element(), changed }
}

// Intent events are synthetic; scroll geometry, focus, smooth settling and submission use Chromium.
function moveGesture(column: Element, top: number, touch = false) {
  column.dispatchEvent(touch ? new Event('touchstart') : new WheelEvent('wheel', { deltaY: top }))
  column.scrollTo({ top, behavior: 'instant' })
  column.dispatchEvent(new Event('scroll'))
}

it('snaps a wheel gesture to the top and selects a draft without committing', async () => {
  const { screen, hours, column, changed } = await renderPicker()
  moveGesture(column, 67)
  column.dispatchEvent(new Event('scrollend'))
  await expect
    .element(hours.getByRole('option', { name: '4', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => column.scrollTop).toBe(78)
  expect(changed).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('16:30')
})

it('highlights the nearest top row during touch without snapping or moving focus until release', async () => {
  const { screen, hours, column, changed } = await renderPicker()
  const first = hours.getByRole('option', { name: '1', exact: true })
  const selectedBackground = getComputedStyle(first.element()).backgroundColor
  moveGesture(column, 67, true)
  const fourth = hours.getByRole('option', { name: '4', exact: true })
  await expect.element(fourth).toHaveAttribute('aria-selected', 'true')
  expect(getComputedStyle(fourth.element()).backgroundColor).toBe(selectedBackground)
  await expect.element(first).toHaveAttribute('aria-selected', 'false')
  await expect.element(first).toHaveFocus()
  expect(column.scrollTop).toBe(67)
  column.scrollTo({ top: 92, behavior: 'instant' })
  column.dispatchEvent(new Event('scroll'))
  const fifth = hours.getByRole('option', { name: '5', exact: true })
  await expect.element(fifth).toHaveAttribute('aria-selected', 'true')
  expect(column.scrollTop).toBe(92)
  expect(changed).not.toHaveBeenCalled()
  await expect.element(screen.getByRole('button', { name: 'Time 1:30 PM' })).toBeInTheDocument()
  column.dispatchEvent(new Event('touchend'))
  column.dispatchEvent(new Event('scrollend'))
  await expect.poll(() => column.scrollTop).toBe(104)
  await expect.element(fifth).toHaveFocus()
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('17:30')
})

it('keeps a clicked target selected throughout positioning after interrupting a gesture', async () => {
  const { screen, hours, column, changed } = await renderPicker()
  moveGesture(column, 67, true)
  await expect
    .element(hours.getByRole('option', { name: '4', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  const target = hours.getByRole('option', { name: '6', exact: true })
  await target.click({ scroll: 'none' })
  column.dispatchEvent(new Event('touchend'))
  column.dispatchEvent(new Event('scrollend'))
  await expect.element(target).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => column.scrollTop).toBe(130)
  await expect.element(target).toHaveAttribute('aria-selected', 'true')
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('18:30')
})

it('aligns AM and PM to the same top anchor for keyboard, click and touch selection', async () => {
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
  moveGesture(column, 6, true)
  await expect.element(am).toHaveAttribute('aria-selected', 'true')
  expect(column.scrollTop).toBe(6)
  expect(changed).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('01:30')
})

it('settles both moving columns synchronously when OK is clicked', async () => {
  const { screen, column, changed } = await renderPicker()
  const minutes = screen.getByRole('listbox', { name: 'Minute' }).element()
  moveGesture(column, 67, true)
  moveGesture(minutes, 1050, true)
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('16:40')
})

it('continues keyboard navigation from the moving candidate and ignores its late scrollend', async () => {
  const { hours, column, changed } = await renderPicker()
  moveGesture(column, 67, true)
  await userEvent.keyboard('{ArrowDown}')
  column.dispatchEvent(new Event('touchend'))
  column.dispatchEvent(new Event('scrollend'))
  await expect.element(hours.getByRole('option', { name: '5', exact: true })).toHaveFocus()
  await expect
    .element(hours.getByRole('option', { name: '5', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  expect(column.scrollTop).toBe(104)
  expect(changed).not.toHaveBeenCalled()
})

it('lets Now override all moving columns and keeps focus on Now', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2025-01-15T13:30:00Z').getTime())
  try {
    const { screen, hours, column, changed } = await renderPicker()
    moveGesture(column, 67, true)
    await screen.getByRole('button', { name: 'Now', exact: true }).click()
    column.dispatchEvent(new Event('touchend'))
    column.dispatchEvent(new Event('scrollend'))
    await expect
      .element(hours.getByRole('option', { name: '1', exact: true }))
      .toHaveAttribute('aria-selected', 'true')
    expect(column.scrollTop).toBe(0)
    await expect.element(screen.getByRole('button', { name: 'Now', exact: true })).toHaveFocus()
    expect(changed).not.toHaveBeenCalled()
  } finally {
    vi.restoreAllMocks()
  }
})

it('discards an unfinished gesture on Escape and ignores detached scroll events', async () => {
  const { screen, column, changed } = await renderPicker()
  moveGesture(column, 67, true)
  await userEvent.keyboard('{Escape}')
  column.dispatchEvent(new Event('touchend'))
  column.dispatchEvent(new Event('scrollend'))
  await expect.element(screen.getByRole('button', { name: 'Time 1:30 PM' })).toHaveFocus()
  expect(changed).not.toHaveBeenCalled()
})

it('does not interpret an edge wheel or programmatic scrolling as selection', async () => {
  const { hours, column } = await renderPicker()
  column.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
  column.dispatchEvent(new Event('scrollend'))
  await expect
    .element(hours.getByRole('option', { name: '1', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  column.scrollTo({ top: 78, behavior: 'instant' })
  column.dispatchEvent(new Event('scroll'))
  column.dispatchEvent(new Event('scrollend'))
  await expect
    .element(hours.getByRole('option', { name: '1', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
})

it('does not lose an unfinished selection when only a modifier key is pressed', async () => {
  const { screen, column, changed } = await renderPicker()
  moveGesture(column, 67, true)
  await userEvent.keyboard('{Shift}')
  await screen.getByRole('button', { name: 'OK', exact: true }).click()
  expect(changed).toHaveBeenCalledExactlyOnceWith('16:30')
})

it('recognizes scrolling when the compositor moves before the passive wheel callback', async () => {
  const { hours, column } = await renderPicker()
  column.scrollTo({ top: 67, behavior: 'instant' })
  column.dispatchEvent(new WheelEvent('wheel', { deltaY: 67 }))
  column.dispatchEvent(new Event('scroll'))
  column.dispatchEvent(new Event('scrollend'))
  await expect
    .element(hours.getByRole('option', { name: '4', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => column.scrollTop).toBe(78)
})

it('settles through the quiet fallback when scrollend is unavailable', async () => {
  let owner: object | null = HTMLElement.prototype
  while (owner && !Object.hasOwn(owner, 'onscrollend')) owner = Object.getPrototypeOf(owner)
  expect(owner).not.toBeNull()
  const descriptor = Object.getOwnPropertyDescriptor(owner!, 'onscrollend')!
  Reflect.deleteProperty(owner!, 'onscrollend')
  try {
    const { hours, column } = await renderPicker()
    moveGesture(column, 67, true)
    column.dispatchEvent(new Event('touchend'))
    await expect
      .element(hours.getByRole('option', { name: '4', exact: true }))
      .toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => column.scrollTop).toBe(78)
  } finally {
    Object.defineProperty(owner!, 'onscrollend', descriptor)
  }
})

it('settles the fallback after a final wheel event produces no additional scroll', async () => {
  let owner: object | null = HTMLElement.prototype
  while (owner && !Object.hasOwn(owner, 'onscrollend')) owner = Object.getPrototypeOf(owner)
  expect(owner).not.toBeNull()
  const descriptor = Object.getOwnPropertyDescriptor(owner!, 'onscrollend')!
  Reflect.deleteProperty(owner!, 'onscrollend')
  try {
    const { hours, column } = await renderPicker()
    moveGesture(column, 67)
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    column.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 }))
    await expect
      .element(hours.getByRole('option', { name: '4' }))
      .toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => column.scrollTop).toBe(78)
  } finally {
    Object.defineProperty(owner!, 'onscrollend', descriptor)
  }
})
