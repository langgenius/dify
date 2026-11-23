import type { ReactNode } from 'react'
import type { SyncPolicyValue } from '../sync-policy-field'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import commonEn from '@/i18n/locales/en-US/common.json'
import knowledgeSourcesEn from '@/i18n/locales/en-US/knowledge-sources.json'
import knowledgeSpaceEn from '@/i18n/locales/en-US/knowledge-space.json'
import commonZh from '@/i18n/locales/zh-Hans/common.json'
import knowledgeSourcesZh from '@/i18n/locales/zh-Hans/knowledge-sources.json'
import knowledgeSpaceZh from '@/i18n/locales/zh-Hans/knowledge-space.json'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { SyncPolicyField } from '../sync-policy-field'

vi.unmock('react-i18next')

function SyncPolicyFieldHarness() {
  const [value, setValue] = useState<SyncPolicyValue>({ mode: 'interval' })
  return (
    <>
      <output aria-label="Saved sync policy">{JSON.stringify(value)}</output>
      <SyncPolicyField value={value} onChange={setValue} />
    </>
  )
}

async function renderWithI18n(node: ReactNode, locale: 'en-US' | 'zh-Hans' = 'en-US') {
  const i18n = createInstance()
  await i18n.init({
    lng: locale,
    fallbackLng: false,
    resources: {
      'en-US': {
        common: commonEn,
        knowledgeSources: knowledgeSourcesEn,
        knowledgeSpace: knowledgeSpaceEn,
      },
      'zh-Hans': {
        common: commonZh,
        knowledgeSources: knowledgeSourcesZh,
        knowledgeSpace: knowledgeSpaceZh,
      },
    },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

describe('SyncPolicyField', () => {
  beforeEach(async () => {
    await page.viewport(640, 600)
    onTestFinished(guardUnexpectedFetch())
  })

  it('shows sync timing for default and preset intervals but not manual sync', async () => {
    const user = userEvent
    await renderWithI18n(<SyncPolicyFieldHarness />)

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
    await user.click(page.getByRole('option', { name: 'Manual only' }))
    await expect.element(trigger).toHaveTextContent('Manual only')
    await expect
      .element(page.getByText(/^First sync runs right after creation/))
      .not.toBeInTheDocument()
  })

  it('separates numbers from units in Simplified Chinese interval labels', async () => {
    const user = userEvent
    await renderWithI18n(<SyncPolicyFieldHarness />, 'zh-Hans')

    await user.click(page.getByRole('combobox', { name: '同步策略' }))

    await expect.element(page.getByRole('option', { name: '每 6 小时' })).toBeInTheDocument()
    await expect.element(page.getByRole('option', { name: '每 3 天' })).toBeInTheDocument()
  })

  it('offers the designed presets and applies a custom day interval explicitly', async () => {
    const user = userEvent
    await renderWithI18n(<SyncPolicyFieldHarness />)

    const trigger = page.getByRole('combobox', { name: 'Sync policy' })
    await user.click(trigger)
    await expect.element(page.getByRole('option', { name: 'Manual only' })).toBeInTheDocument()
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
    await renderWithI18n(<SourceForm />)

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
    await renderWithI18n(<SyncPolicyFieldHarness />)

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
    await renderWithI18n(<SyncPolicyFieldHarness />)

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
