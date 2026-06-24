import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { AUTO_UPDATE_MODE, AUTO_UPDATE_STRATEGY } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { ACCOUNT_SETTING_TAB } from '../constants'
import UpdateSettingDialogForm from '../update-setting-dialog-form'

const mockSetShowAccountSettingModal = vi.fn()

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: (selector: (s: { setShowAccountSettingModal: typeof mockSetShowAccountSettingModal }) => typeof mockSetShowAccountSettingModal) => {
    return selector({ setShowAccountSettingModal: mockSetShowAccountSettingModal })
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: (defaultNs?: string) => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const ns = (options?.ns as string | undefined) ?? defaultNs
      return `${ns ? `${ns}.` : ''}${key}`
    },
    i18n: {
      language: 'en',
      changeLanguage: vi.fn(),
    },
  }),
  Trans: ({ i18nKey, components }: {
    i18nKey: string
    components?: Record<string, React.ReactElement>
  }) => {
    const setTimezone = components?.setTimezone
    if (setTimezone)
      return React.cloneElement(setTimezone, undefined, i18nKey)

    return <span>{i18nKey}</span>
  },
}))

vi.mock('@/app/components/base/date-and-time-picker/time-picker', () => ({
  default: () => <div data-testid="time-picker" />,
}))

vi.mock('@/app/components/plugins/reference-setting-modal/auto-update-setting/plugins-picker', () => ({
  default: () => <div data-testid="plugins-picker" />,
}))

describe('UpdateSettingDialogForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
        scopeOptions={[
          { value: AUTO_UPDATE_MODE.update_all, label: 'All' },
        ]}
        strategyOptions={[
          { value: AUTO_UPDATE_STRATEGY.fixOnly, label: 'Fix only' },
        ]}
        timezone="UTC"
        updateTimeValue="00:00"
        minuteFilter={minutes => minutes}
        onAutoUpgradeChange={vi.fn()}
        onPluginsChange={vi.fn()}
        onRequestClose={onRequestClose}
        onUpdateTimeChange={vi.fn()}
        renderTimePickerTrigger={() => <button type="button">Pick time</button>}
      />,
    )

    fireEvent.click(screen.getByText('autoUpdate.changeTimezone'))

    expect(onRequestClose).toHaveBeenCalledTimes(1)
    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({ payload: ACCOUNT_SETTING_TAB.PREFERENCES })
  })
})
