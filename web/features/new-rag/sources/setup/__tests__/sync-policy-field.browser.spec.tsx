import type { SyncPolicyValue } from '../sync-policy-field'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { SyncPolicyField } from '../sync-policy-field'

const i18nLanguage = vi.hoisted(() => ({ current: 'en-US' }))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const mock = createReactI18nextMock({
    'common.operation.cancel': 'Cancel',
    'knowledgeSources.syncPolicy': 'Sync policy',
    'knowledgeSources.syncPolicyApply': 'Apply',
    'knowledgeSources.syncPolicyCustom': 'Custom interval',
    'knowledgeSources.syncPolicyCustomDescription':
      'First sync runs right after creation, then {{interval}}.',
    'knowledgeSources.syncPolicyCustomHelp': 'From 1 hour to 30 days. Will sync {{interval}}.',
    'knowledgeSources.syncPolicyCustomValue': 'Custom · {{interval}}',
    'knowledgeSources.syncPolicyDaily': 'Every 24 hours',
    'knowledgeSources.syncPolicyEditCustom': 'Edit custom interval',
    'knowledgeSources.syncPolicyEvery': 'Every',
    'knowledgeSources.syncPolicyEveryValue': 'Every {{interval}}',
    'knowledgeSources.syncPolicyManual': 'Manual sync',
    'knowledgeSpace.syncPolicyUnit.days': 'days',
    'knowledgeSpace.syncPolicyUnit.hours': 'hours',
  })
  return {
    ...mock,
    useTranslation: ((...args: Parameters<typeof mock.useTranslation>) => {
      const result = mock.useTranslation(...args)
      return {
        ...result,
        i18n: {
          ...result.i18n,
          language: i18nLanguage.current,
          resolvedLanguage: i18nLanguage.current,
        },
      }
    }) as typeof mock.useTranslation,
  }
})

function SyncPolicyFieldHarness() {
  const [value, setValue] = useState<SyncPolicyValue>({ mode: 'interval' })
  return (
    <>
      <output aria-label="Saved sync policy">{JSON.stringify(value)}</output>
      <SyncPolicyField value={value} onChange={setValue} />
    </>
  )
}

describe('SyncPolicyField', () => {
  beforeEach(async () => {
    await page.viewport(640, 600)
    onTestFinished(guardUnexpectedFetch())
    i18nLanguage.current = 'en-US'
  })

  it('shows sync timing for default and preset intervals but not manual sync', async () => {
    const user = userEvent
    await render(<SyncPolicyFieldHarness />)

    const trigger = page.getByRole('combobox', { name: 'Sync policy' })
    await expect.element(trigger).toHaveTextContent('Every 24 hours')
    await expect
      .element(page.getByText('First sync runs right after creation, then every 24 hours.'))
      .toBeVisible()

    await user.click(trigger)
    await user.click(page.getByRole('option', { name: 'Every 3 days' }))
    await expect
      .element(page.getByText('First sync runs right after creation, then every 3 days.'))
      .toBeVisible()

    await user.click(trigger)
    await user.click(page.getByRole('option', { name: 'Manual sync' }))
    await expect.element(trigger).toHaveTextContent('Manual sync')
    await expect
      .element(page.getByText(/^First sync runs right after creation/))
      .not.toBeInTheDocument()
  })

  it('separates numbers from units in Simplified Chinese interval labels', async () => {
    i18nLanguage.current = 'zh-Hans'
    const user = userEvent
    await render(<SyncPolicyFieldHarness />)

    await user.click(page.getByRole('combobox', { name: 'Sync policy' }))

    await expect.element(page.getByRole('option', { name: 'Every 6 小时' })).toBeInTheDocument()
    await expect.element(page.getByRole('option', { name: 'Every 3 天' })).toBeInTheDocument()
  })

  it('offers the designed presets and applies a custom day interval explicitly', async () => {
    const user = userEvent
    await render(<SyncPolicyFieldHarness />)

    const trigger = page.getByRole('combobox', { name: 'Sync policy' })
    await user.click(trigger)
    await expect.element(page.getByRole('option', { name: 'Manual sync' })).toBeInTheDocument()
    await expect.element(page.getByRole('option', { name: 'Every 6 hours' })).toBeInTheDocument()
    await expect.element(page.getByRole('option', { name: 'Every 12 hours' })).toBeInTheDocument()
    await expect.element(page.getByRole('option', { name: 'Every 24 hours' })).toBeInTheDocument()
    await expect.element(page.getByRole('option', { name: 'Every 3 days' })).toBeInTheDocument()
    await expect.element(page.getByRole('option', { name: 'Every 7 days' })).toBeInTheDocument()

    await user.click(page.getByRole('option', { name: 'Custom interval' }))
    const popover = page.getByRole('dialog')
    await expect
      .element(page.getByRole('status', { name: 'Saved sync policy' }))
      .toHaveTextContent('{"mode":"interval"}')

    const interval = popover.getByRole('textbox', {
      name: 'Custom interval hours',
    })
    await expect.element(interval).toBeVisible()
    await interval.fill('2')
    await user.click(popover.getByRole('combobox', { name: 'Custom interval' }))
    await user.click(page.getByRole('option', { name: 'days' }))
    await expect
      .element(page.getByRole('status', { name: 'Saved sync policy' }))
      .toHaveTextContent('{"mode":"interval"}')

    await user.click(popover.getByRole('button', { name: 'Apply' }))
    await expect.element(popover).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('status', { name: 'Saved sync policy' }))
      .toHaveTextContent('{"customIntervalSeconds":172800,"mode":"custom"}')
    await expect.element(trigger).toHaveTextContent('Every 2 days')
    await expect
      .element(page.getByText('First sync runs right after creation, then every 2 days.'))
      .toBeInTheDocument()

    await user.click(trigger)
    await expect
      .element(page.getByRole('option', { name: 'Custom · every 2 days' }))
      .toBeInTheDocument()
    await user.click(page.getByRole('option', { name: 'Edit custom interval' }))
    const reopenedPopover = page.getByRole('dialog')
    await expect
      .element(reopenedPopover.getByRole('textbox', { name: 'Custom interval days' }))
      .toHaveValue('2')
  })

  it('applies the custom interval through its own form without submitting an enclosing form', async () => {
    const user = userEvent
    function SourceForm() {
      const [submitted, setSubmitted] = useState(false)
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setSubmitted(true)
          }}
        >
          <SyncPolicyFieldHarness />
          <button type="submit">Create source</button>
          {submitted && <p>Source submitted</p>}
        </form>
      )
    }
    await render(<SourceForm />)

    await user.click(page.getByRole('combobox', { name: 'Sync policy' }))
    await user.click(page.getByRole('option', { name: 'Custom interval' }))
    const popover = page.getByRole('dialog')
    const interval = popover.getByRole('textbox', { name: 'Custom interval hours' })
    await interval.fill('8')
    await expect.element(interval).toHaveValue('8')
    await user.keyboard('{Enter}')

    await expect
      .element(page.getByRole('status', { name: 'Saved sync policy' }))
      .toHaveTextContent('{"customIntervalSeconds":28800,"mode":"custom"}')
    await expect.element(popover).not.toBeInTheDocument()
    await expect.element(page.getByText('Source submitted')).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'Create source' }).click()
    await expect.element(page.getByText('Source submitted')).toBeVisible()
  })

  it('closes the custom interval popover on Escape and resets its draft when reopened', async () => {
    const user = userEvent
    await render(<SyncPolicyFieldHarness />)

    const trigger = page.getByRole('combobox', { name: 'Sync policy' })
    await user.click(trigger)
    await user.click(page.getByRole('option', { name: 'Custom interval' }))
    let popover = page.getByRole('dialog')
    const interval = popover.getByRole('textbox', { name: 'Custom interval hours' })
    await interval.fill('5')
    await user.keyboard('{Escape}')

    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await user.click(trigger)
    await user.click(page.getByRole('option', { name: 'Custom interval' }))
    popover = page.getByRole('dialog')
    await expect
      .element(popover.getByRole('textbox', { name: 'Custom interval hours' }))
      .toHaveValue('36')
  })

  it('discards edits on cancel and clamps the value to 30 days', async () => {
    const user = userEvent
    await render(<SyncPolicyFieldHarness />)

    const trigger = page.getByRole('combobox', { name: 'Sync policy' })
    await user.click(trigger)
    await user.click(page.getByRole('option', { name: 'Custom interval' }))
    let popover = page.getByRole('dialog')
    await popover.getByRole('textbox', { name: 'Custom interval hours' }).fill('5')
    await user.click(popover.getByRole('button', { name: 'Cancel' }))
    await expect.element(popover).not.toBeInTheDocument()
    await expect
      .element(page.getByRole('status', { name: 'Saved sync policy' }))
      .toHaveTextContent('{"mode":"interval"}')

    await user.click(trigger)
    await user.click(page.getByRole('option', { name: 'Custom interval' }))
    popover = page.getByRole('dialog')
    const interval = popover.getByRole('textbox', {
      name: 'Custom interval hours',
    })
    await expect.element(interval).toBeVisible()
    await interval.fill('40')
    await user.click(popover.getByRole('combobox', { name: 'Custom interval' }))
    await user.click(page.getByRole('option', { name: 'days' }))
    const days = popover.getByRole('textbox', { name: 'Custom interval days' })
    await days.click()
    await user.tab()
    await expect.element(days).toHaveValue('30')
    await user.click(popover.getByRole('button', { name: 'Apply' }))
    await expect.element(popover).not.toBeInTheDocument()

    await expect
      .element(page.getByRole('status', { name: 'Saved sync policy' }))
      .toHaveTextContent('{"customIntervalSeconds":2592000,"mode":"custom"}')
  })
})
