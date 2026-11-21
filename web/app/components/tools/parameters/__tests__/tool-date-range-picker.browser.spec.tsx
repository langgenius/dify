import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import time from '@/i18n/locales/en-US/time.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import { ToolDateRangePicker } from '../tool-date-range-picker'

vi.unmock('react-i18next')

it('clears each range boundary in keyboard order while preserving the other date', async () => {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { common, time, workflow } },
  })
  function BookingDates() {
    const [value, setValue] = useState(JSON.stringify({ start: '2024-05-01', end: '2024-05-03' }))
    return (
      <>
        <ToolDateRangePicker label="Booking dates" value={value} onChange={setValue} />
        <output aria-label="Saved dates">{value || 'No dates'}</output>
      </>
    )
  }
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <BookingDates />
    </I18nextProvider>,
  )
  const dates = screen.getByRole('group', { name: 'Booking dates' })
  for (const name of [
    'Start date May 1, 2024',
    'Start date: Clear',
    'End date May 3, 2024',
    'End date: Clear',
  ]) {
    await userEvent.tab()
    await expect.element(dates.getByRole('button', { name, exact: true })).toHaveFocus()
  }
  await dates.getByRole('button', { name: 'Start date: Clear', exact: true }).click()
  await expect
    .element(screen.getByRole('status', { name: 'Saved dates' }))
    .toHaveTextContent('{"end":"2024-05-03"}')
  await expect.element(dates.getByRole('button', { name: 'End date May 3, 2024' })).toBeVisible()
  await dates.getByRole('button', { name: 'End date: Clear', exact: true }).click()
  await expect
    .element(screen.getByRole('status', { name: 'Saved dates' }))
    .toHaveTextContent('No dates')
  await expect.element(dates.getByRole('button', { name: /Clear/ })).not.toBeInTheDocument()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})
