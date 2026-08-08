import type { SettingsDestination } from '@/app/components/header/account-setting/query-params'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import {
  AUTO_UPDATE_MODE,
  AUTO_UPDATE_STRATEGY,
} from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import UpdateSettingDialogForm from '../update-setting-dialog-form'

const mockSetSettingsDestination = vi.fn()
let mockSettingsDestination: SettingsDestination | null = null
vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return {
    ...actual,
    useQueryState: () => [mockSettingsDestination, mockSetSettingsDestination],
  }
})

vi.mock('react-i18next', async () => {
  const { withSelectorKey, withSelectorKeyProps } = await import('@/test/i18n-mock')
  return {
    useTranslation: (defaultNs?: string) => ({
      t: withSelectorKey((key: string, options?: Record<string, unknown>) => {
        const ns = (options?.ns as string | undefined) ?? defaultNs
        return `${ns ? `${ns}.` : ''}${key}`
      }),
      i18n: {
        language: 'en',
        changeLanguage: vi.fn(),
      },
    }),
    Trans: withSelectorKeyProps(
      ({
        i18nKey,
        components,
      }: {
        i18nKey: string
        components?: Record<string, React.ReactElement>
      }) => {
        const setTimezone = components?.setTimezone
        if (setTimezone) return React.cloneElement(setTimezone, undefined, i18nKey)

        return <span>{i18nKey}</span>
      },
    ),
  }
})

vi.mock(
  '@/app/components/plugins/reference-setting-modal/auto-update-setting/plugins-picker',
  () => ({
    default: () => <div data-testid="plugins-picker" />,
  }),
)

describe('UpdateSettingDialogForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettingsDestination = null
  })

  it('should open preferences after closing the update setting dialog when timezone link is clicked', () => {
    const onRequestClose = vi.fn()

    render(
      <UpdateSettingDialogForm
        autoUpgrade={{
          strategy_setting: AUTO_UPDATE_STRATEGY.fixOnly,
          upgrade_time_of_day: 0,
          upgrade_mode: AUTO_UPDATE_MODE.update_all,
          exclude_plugins: [],
          include_plugins: [],
        }}
        category={PluginCategoryEnum.tool}
        plugins={[]}
        scopeOptions={[{ value: AUTO_UPDATE_MODE.update_all, label: 'All' }]}
        strategyOptions={[{ value: AUTO_UPDATE_STRATEGY.fixOnly, label: 'Fix only' }]}
        timezone="UTC"
        updateTimeValue="00:00"
        minuteFilter={(minutes) => minutes}
        onAutoUpgradeChange={vi.fn()}
        onPluginsChange={vi.fn()}
        onRequestClose={onRequestClose}
        onUpdateTimeChange={vi.fn()}
        renderTimePickerTrigger={() => <button type="button">Pick time</button>}
      />,
    )

    fireEvent.click(screen.getByText('autoUpdate.changeTimezone'))

    expect(onRequestClose).toHaveBeenCalledTimes(1)
    expect(mockSetSettingsDestination).toHaveBeenCalledWith('preferences')
  })

  it('should replace the current destination when timezone link is clicked inside settings', () => {
    mockSettingsDestination = 'provider'

    render(
      <UpdateSettingDialogForm
        autoUpgrade={{
          strategy_setting: AUTO_UPDATE_STRATEGY.fixOnly,
          upgrade_time_of_day: 0,
          upgrade_mode: AUTO_UPDATE_MODE.update_all,
          exclude_plugins: [],
          include_plugins: [],
        }}
        category={PluginCategoryEnum.tool}
        plugins={[]}
        scopeOptions={[{ value: AUTO_UPDATE_MODE.update_all, label: 'All' }]}
        strategyOptions={[{ value: AUTO_UPDATE_STRATEGY.fixOnly, label: 'Fix only' }]}
        timezone="UTC"
        updateTimeValue="00:00"
        minuteFilter={(minutes) => minutes}
        onAutoUpgradeChange={vi.fn()}
        onPluginsChange={vi.fn()}
        onRequestClose={vi.fn()}
        onUpdateTimeChange={vi.fn()}
        renderTimePickerTrigger={() => <button type="button">Pick time</button>}
      />,
    )

    fireEvent.click(screen.getByText('autoUpdate.changeTimezone'))

    expect(mockSetSettingsDestination).toHaveBeenCalledWith('preferences', {
      history: 'replace',
      shallow: true,
    })
  })
})
