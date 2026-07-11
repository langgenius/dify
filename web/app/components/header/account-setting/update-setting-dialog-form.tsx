import type { ReactElement, ReactNode } from 'react'
import type { TriggerParams } from '@/app/components/base/date-and-time-picker/types'
import type { AutoUpdateConfig } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import type { dayjsToTimeOfDay } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/utils'
import type { PluginCategoryEnum } from '@/app/components/plugins/types'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioGroup } from '@langgenius/dify-ui/radio'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import TimePicker from '@/app/components/base/date-and-time-picker/time-picker'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import PluginsPicker from '@/app/components/plugins/reference-setting-modal/auto-update-setting/plugins-picker'
import { AUTO_UPDATE_MODE, AUTO_UPDATE_STRATEGY } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import { convertLocalSecondsToUTCDaySeconds } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/utils'
import { useModalContextSelector } from '@/context/modal-context'
import UpdateSettingOptionCard from './update-setting-option-card'

type Option<Value extends string> = {
  value: Value
  label: string
}

type UpdateSettingDialogFormProps = {
  autoUpgrade: AutoUpdateConfig
  category: PluginCategoryEnum
  plugins: string[]
  scopeOptions: Option<AUTO_UPDATE_MODE>[]
  strategyOptions: Option<AUTO_UPDATE_STRATEGY>[]
  timezone: string
  updateTimeValue: string
  minuteFilter: (minutes: string[]) => string[]
  onAutoUpgradeChange: (payload: Partial<AutoUpdateConfig>) => void
  onPluginsChange: (newPlugins: string[]) => void
  onRequestClose: () => void
  onUpdateTimeChange: (value: Parameters<typeof dayjsToTimeOfDay>[0]) => void
  renderTimePickerTrigger: (params: TriggerParams) => ReactElement
}

const updateSettingFormLabelClassName = 'flex min-h-6 w-full items-center system-sm-medium text-text-secondary'

function SettingTimeZone({
  children,
  onRequestClose,
}: {
  children?: ReactNode
  onRequestClose: () => void
}) {
  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)

  return (
    <button
      type="button"
      className="cursor-pointer border-none bg-transparent p-0 text-left body-xs-regular text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
      onClick={() => {
        onRequestClose()
        setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.PREFERENCES })
      }}
    >
      {children}
    </button>
  )
}

const UpdateSettingDialogForm = ({
  autoUpgrade,
  category,
  plugins,
  scopeOptions,
  strategyOptions,
  timezone,
  updateTimeValue,
  minuteFilter,
  onAutoUpgradeChange,
  onPluginsChange,
  onRequestClose,
  onUpdateTimeChange,
  renderTimePickerTrigger,
}: UpdateSettingDialogFormProps) => {
  const { t } = useTranslation()
  const [previewStrategy, setPreviewStrategy] = useState<AUTO_UPDATE_STRATEGY>()
  const displayedStrategy = previewStrategy ?? autoUpgrade.strategy_setting
  const getStrategyDescription = (strategy: AUTO_UPDATE_STRATEGY) => {
    switch (strategy) {
      case AUTO_UPDATE_STRATEGY.disabled:
        return t($ => $['autoUpdate.strategy.disabled.description'], { ns: 'plugin' })
      case AUTO_UPDATE_STRATEGY.fixOnly:
        return t($ => $['autoUpdate.strategy.fixOnly.description'], { ns: 'plugin' })
      case AUTO_UPDATE_STRATEGY.latest:
        return t($ => $['autoUpdate.strategy.latest.description'], { ns: 'plugin' })
      default:
        return ''
    }
  }
  const strategyDescription = getStrategyDescription(displayedStrategy)

  return (
    <div className="flex w-full flex-col gap-4 px-6 py-3">
      <div className="flex w-full flex-col items-start gap-1">
        <div className="flex w-full flex-col items-start gap-1">
          <div className={updateSettingFormLabelClassName}>
            {t($ => $['autoUpdate.autoUpdate'], { ns: 'plugin' })}
          </div>
          <RadioGroup<AUTO_UPDATE_STRATEGY>
            aria-label={t($ => $['autoUpdate.autoUpdate'], { ns: 'plugin' })}
            className="flex w-full gap-2"
            value={autoUpgrade.strategy_setting}
            onValueChange={strategy_setting => onAutoUpgradeChange({ strategy_setting })}
          >
            {strategyOptions.map(option => (
              <UpdateSettingOptionCard<AUTO_UPDATE_STRATEGY>
                key={option.value}
                value={option.value}
                label={option.label}
                onFocus={() => setPreviewStrategy(option.value)}
                onBlur={() => setPreviewStrategy(undefined)}
                onMouseEnter={() => setPreviewStrategy(option.value)}
                onMouseLeave={() => setPreviewStrategy(undefined)}
              />
            ))}
          </RadioGroup>
          <div className="w-full body-xs-regular text-text-tertiary">
            {strategyDescription}
          </div>
        </div>
      </div>
      {autoUpgrade.strategy_setting !== AUTO_UPDATE_STRATEGY.disabled && (
        <>
          <div className="h-px w-full bg-divider-subtle" />
          <div className="flex w-full flex-col items-start gap-1">
            <div className="flex w-full items-center gap-2">
              <div className={cn(updateSettingFormLabelClassName, 'min-w-0 flex-1')}>
                {t($ => $['autoUpdate.updateTime'], { ns: 'plugin' })}
              </div>
              <div className="body-xs-regular text-text-tertiary">
                <Trans
                  i18nKey={$ => $['autoUpdate.changeTimezone']}
                  ns="plugin"
                  components={{
                    setTimezone: <SettingTimeZone onRequestClose={onRequestClose} />,
                  }}
                />
              </div>
            </div>
            <TimePicker
              value={updateTimeValue}
              timezone={timezone}
              onChange={onUpdateTimeChange}
              onClear={() => onAutoUpgradeChange({
                upgrade_time_of_day: convertLocalSecondsToUTCDaySeconds(0, timezone),
              })}
              title={t($ => $['autoUpdate.updateTime'], { ns: 'plugin' })}
              minuteFilter={minuteFilter}
              renderTrigger={renderTimePickerTrigger}
              placement="bottom-start"
            />
          </div>
          <div className="flex w-full flex-col items-start gap-2">
            <div className="flex h-[60px] w-full flex-col items-start gap-1">
              <div className={updateSettingFormLabelClassName}>
                {t($ => $['autoUpdate.scope'], { ns: 'plugin' })}
              </div>
              <RadioGroup<AUTO_UPDATE_MODE>
                aria-label={t($ => $['autoUpdate.scope'], { ns: 'plugin' })}
                className="flex w-full gap-2"
                value={autoUpgrade.upgrade_mode}
                onValueChange={upgrade_mode => onAutoUpgradeChange({ upgrade_mode })}
              >
                {scopeOptions.map(option => (
                  <UpdateSettingOptionCard<AUTO_UPDATE_MODE>
                    key={option.value}
                    value={option.value}
                    label={option.label}
                  />
                ))}
              </RadioGroup>
            </div>
            {autoUpgrade.upgrade_mode !== AUTO_UPDATE_MODE.update_all && (
              <PluginsPicker
                value={plugins}
                onChange={onPluginsChange}
                updateMode={autoUpgrade.upgrade_mode}
                integrationCategory={category}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default UpdateSettingDialogForm
