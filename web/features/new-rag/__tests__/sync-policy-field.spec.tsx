import type { SyncPolicyValue } from '../sync-policy-field'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { render } from '@/test/console/render'
import { createReactI18nextMock } from '@/test/i18n-mock'
import { SyncPolicyField } from '../sync-policy-field'

const i18nLanguage = vi.hoisted(() => ({ current: 'en-US' }))

vi.mock('react-i18next', () => {
  const mock = createReactI18nextMock({
    'common.operation.cancel': 'Cancel',
    'dataset.newKnowledge.syncPolicy': 'Sync policy',
    'dataset.newKnowledge.syncPolicyApply': 'Apply',
    'dataset.newKnowledge.syncPolicyCustom': 'Custom interval',
    'dataset.newKnowledge.syncPolicyCustomDescription':
      'First sync runs right after creation, then {{interval}}.',
    'dataset.newKnowledge.syncPolicyCustomHelp': 'From 1 hour to 30 days. Will sync {{interval}}.',
    'dataset.newKnowledge.syncPolicyCustomValue': 'Custom · {{interval}}',
    'dataset.newKnowledge.syncPolicyDaily': 'Every 24 hours',
    'dataset.newKnowledge.syncPolicyEditCustom': 'Edit custom interval',
    'dataset.newKnowledge.syncPolicyEvery': 'Every',
    'dataset.newKnowledge.syncPolicyEveryValue': 'Every {{interval}}',
    'dataset.newKnowledge.syncPolicyManual': 'Manual sync',
    'dataset.newKnowledge.syncPolicyUnit.days': 'days',
    'dataset.newKnowledge.syncPolicyUnit.hours': 'hours',
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
      <output data-testid="policy-value">{JSON.stringify(value)}</output>
      <SyncPolicyField
        availableModes={['manual', 'interval', 'custom']}
        value={value}
        onChange={setValue}
      />
    </>
  )
}

describe('SyncPolicyField', () => {
  beforeEach(() => {
    i18nLanguage.current = 'en-US'
  })

  it('separates numbers from units in Simplified Chinese interval labels', async () => {
    i18nLanguage.current = 'zh-Hans'
    const user = userEvent.setup()
    render(<SyncPolicyFieldHarness />)

    await user.click(screen.getByRole('combobox', { name: 'Sync policy' }))

    expect(screen.getByRole('option', { name: 'Every 6 小时' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Every 3 天' })).toBeInTheDocument()
  })

  it('offers the designed presets and applies a custom day interval explicitly', async () => {
    const user = userEvent.setup()
    render(<SyncPolicyFieldHarness />)

    const trigger = screen.getByRole('combobox', { name: 'Sync policy' })
    await user.click(trigger)
    expect(screen.getByRole('option', { name: 'Manual sync' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Every 6 hours' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Every 12 hours' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Every 24 hours' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Every 3 days' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Every 7 days' })).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: 'Custom interval' }))
    const popover = await screen.findByRole('dialog')
    expect(screen.getByTestId('policy-value')).toHaveTextContent('{"mode":"interval"}')

    const interval = within(popover).getByRole('textbox', {
      name: 'Custom interval hours',
    })
    await user.clear(interval)
    await user.type(interval, '2')
    await user.click(within(popover).getByRole('combobox', { name: 'Custom interval' }))
    await user.click(screen.getByRole('option', { name: 'days' }))
    expect(screen.getByTestId('policy-value')).toHaveTextContent('{"mode":"interval"}')

    await user.click(within(popover).getByRole('button', { name: 'Apply' }))
    expect(screen.getByTestId('policy-value')).toHaveTextContent(
      '{"customIntervalSeconds":172800,"mode":"custom"}',
    )
    expect(trigger).toHaveTextContent('Every 2 days')
    expect(
      screen.getByText('First sync runs right after creation, then every 2 days.'),
    ).toBeInTheDocument()

    await user.click(trigger)
    expect(screen.getByRole('option', { name: 'Custom · every 2 days' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Edit custom interval' }))
    const reopenedPopover = await screen.findByRole('dialog')
    expect(
      within(reopenedPopover).getByRole('textbox', { name: 'Custom interval days' }),
    ).toHaveValue('2')
  })

  it('discards edits on cancel and clamps the value to 30 days', async () => {
    const user = userEvent.setup()
    render(<SyncPolicyFieldHarness />)

    const trigger = screen.getByRole('combobox', { name: 'Sync policy' })
    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'Custom interval' }))
    let popover = await screen.findByRole('dialog')
    await user.click(within(popover).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('policy-value')).toHaveTextContent('{"mode":"interval"}')

    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'Custom interval' }))
    popover = await screen.findByRole('dialog')
    const interval = within(popover).getByRole('textbox', {
      name: 'Custom interval hours',
    })
    await user.clear(interval)
    await user.type(interval, '40')
    await user.click(within(popover).getByRole('combobox', { name: 'Custom interval' }))
    await user.click(screen.getByRole('option', { name: 'days' }))
    await user.click(interval)
    await user.tab()
    expect(interval).toHaveValue('30')
    await user.click(within(popover).getByRole('button', { name: 'Apply' }))

    await waitFor(() =>
      expect(screen.getByTestId('policy-value')).toHaveTextContent(
        '{"customIntervalSeconds":2592000,"mode":"custom"}',
      ),
    )
  })
})
