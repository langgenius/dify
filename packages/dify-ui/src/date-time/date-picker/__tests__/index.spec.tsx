import { zhCN } from '@daypicker/react/locale/zh-CN'
import * as React from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { DatePicker, DatePickerContent, DatePickerLabel, DatePickerTrigger } from '../index'

it('confirms the selected day without clearing it or emitting a duplicate change', async () => {
  const changed = vi.fn()
  const screen = await render(
    <DatePicker defaultValue="2025-01-15" onValueChange={changed}>
      <DatePickerLabel className="sr-only">Date</DatePickerLabel>
      <DatePickerTrigger />
      <DatePickerContent />
    </DatePicker>,
  )
  const trigger = screen.getByRole('button', { name: 'Date Jan 15, 2025' })
  await trigger.click()
  await userEvent.keyboard('{Enter}')
  await expect.element(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(changed).not.toHaveBeenCalled()
})

it('preserves localized today and selection semantics in the styled day button', async () => {
  vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
  try {
    const screen = await render(
      <DatePicker locale={zhCN} defaultValue="2026-09-28">
        <DatePickerLabel className="sr-only">Date</DatePickerLabel>
        <DatePickerTrigger />
        <DatePickerContent />
      </DatePicker>,
    )
    await screen.getByRole('button', { name: /^Date / }).click()
    const today = screen.getByRole('button', { name: '今天，2026年9月28日 星期一，已选择' })
    await expect.element(today).toHaveAttribute('aria-current', 'date')
    await expect.element(today).toHaveTextContent('28')
    await expect.element(today).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    await expect
      .element(screen.getByRole('button', { name: '2026年9月29日 星期二' }))
      .not.toHaveAttribute('aria-current')
  } finally {
    vi.useRealTimers()
  }
})
