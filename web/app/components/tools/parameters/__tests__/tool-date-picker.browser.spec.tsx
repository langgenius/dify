import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import time from '@/i18n/locales/en-US/time.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import { ToolDatePicker } from '../tool-date-picker'

vi.unmock('react-i18next')

async function setup(readOnly = false) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { common, time, workflow } },
  })
  function DateField() {
    const [value, setValue] = useState('2024-05-01')
    return (
      <ToolDatePicker
        aria-label="Select date"
        value={value}
        onChange={setValue}
        readOnly={readOnly}
      />
    )
  }
  return render(
    <I18nextProvider i18n={i18n}>
      <DateField />
    </I18nextProvider>,
  )
}

it('allows browsing a read-only date without changing or clearing the tool value', async () => {
  const screen = await setup(true)
  const trigger = screen.getByRole('button', { name: 'Select date May 1, 2024' })
  await trigger.click()
  await expect.element(screen.getByRole('grid')).toHaveAttribute('aria-readonly', 'true')
  await screen.getByRole('button', { name: /May 20th/ }).click()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  await expect.element(trigger).toBeVisible()
})

it('returns focus after keyboard dismissal and clears the controlled date without reopening', async () => {
  const screen = await setup()
  const trigger = screen.getByRole('button', { name: 'Select date May 1, 2024' })
  await userEvent.tab()
  await expect.element(trigger).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('dialog')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'Clear', exact: true })).toHaveFocus()
  await userEvent.keyboard(' ')
  await expect.element(screen.getByRole('button', { name: /Select date Pick Date/ })).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Clear', exact: true }))
    .not.toBeInTheDocument()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})
