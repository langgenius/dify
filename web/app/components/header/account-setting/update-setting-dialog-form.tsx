import type { ReactNode } from 'react'
import type { AutoUpdateConfig } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import type { PluginCategoryEnum } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogClose } from '@langgenius/dify-ui/dialog'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  TimePicker,
  TimePickerContent,
  TimePickerLabel,
  TimePickerTrigger,
  TimePickerValue,
} from '@/app/components/base/date-time-picker/time-picker'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import PluginsPicker from '@/app/components/plugins/reference-setting-modal/auto-update-setting/plugins-picker'
import {
  AUTO_UPDATE_MODE,
  AUTO_UPDATE_STRATEGY,
} from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import {
  convertLocalSecondsToUTCDaySeconds,
  convertUTCDaySecondsToLocalSeconds,
} from '@/app/components/plugins/reference-setting-modal/auto-update-setting/utils'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { convertTimezoneToOffsetStr } from '@/utils/timezone'
import UpdateSettingOptionCard from './update-setting-option-card'

type UpdateSettingDialogFormProps = {
  initialAutoUpgrade: AutoUpdateConfig
  category: PluginCategoryEnum
  isSavePending: boolean
  onSave: (autoUpgrade: AutoUpdateConfig) => void
}

const updateSettingFormLabelClassName =
  'flex min-h-6 w-full items-center system-sm-medium text-text-secondary'

function SettingTimeZone({ children }: { children?: ReactNode }) {
  const [settingsDestination, setSettingsDestination] = useQueryState(
    settingsQueryParamName,
    settingsQueryParser,
  )

  return (
    <DialogClose
      className="cursor-pointer border-none bg-transparent p-0 text-left body-xs-regular text-text-accent focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      onClick={() => {
        if (settingsDestination)
          setSettingsDestination('preferences', { history: 'replace', shallow: true })
        else setSettingsDestination('preferences')
      }}
    >
      {children}
    </DialogClose>
  )
}

export function UpdateSettingDialogForm({
  initialAutoUpgrade,
  category,
  isSavePending,
  onSave,
}: UpdateSettingDialogFormProps) {
  const { t } = useTranslation(['plugin', 'common'])
  const { data: timezone } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.timezone || 'UTC',
  })
  const [autoUpgrade, setAutoUpgrade] = useState(initialAutoUpgrade)
  const onAutoUpgradeChange = (payload: Partial<AutoUpdateConfig>) => {
    setAutoUpgrade((current) => ({ ...current, ...payload }))
  }
  const plugins =
    autoUpgrade.upgrade_mode === AUTO_UPDATE_MODE.partial
      ? autoUpgrade.include_plugins
      : autoUpgrade.upgrade_mode === AUTO_UPDATE_MODE.exclude
        ? autoUpgrade.exclude_plugins
        : []
  const onPluginsChange = (newPlugins: string[]) => {
    if (autoUpgrade.upgrade_mode === AUTO_UPDATE_MODE.partial)
      onAutoUpgradeChange({ include_plugins: newPlugins })
    else if (autoUpgrade.upgrade_mode === AUTO_UPDATE_MODE.exclude)
      onAutoUpgradeChange({ exclude_plugins: newPlugins })
  }
  const localSeconds = convertUTCDaySecondsToLocalSeconds(autoUpgrade.upgrade_time_of_day, timezone)
  const updateTimeValue = `${String(Math.floor(localSeconds / 3600)).padStart(2, '0')}:${String(Math.floor((localSeconds % 3600) / 60)).padStart(2, '0')}`
  const onUpdateTimeChange = (value: string | null) => {
    const [hour, minute] = (value ?? '00:00').split(':').map(Number)
    onAutoUpgradeChange({
      upgrade_time_of_day: convertLocalSecondsToUTCDaySeconds(
        hour! * 3600 + minute! * 60,
        timezone,
      ),
    })
  }
  const strategyOptions = [
    {
      value: AUTO_UPDATE_STRATEGY.disabled,
      label: t(($) => $['autoUpdate.strategy.disabled.name'], { ns: 'plugin' }),
    },
    {
      value: AUTO_UPDATE_STRATEGY.fixOnly,
      label: t(($) => $['autoUpdate.strategy.fixOnly.name'], { ns: 'plugin' }),
    },
    {
      value: AUTO_UPDATE_STRATEGY.latest,
      label: t(($) => $['autoUpdate.strategy.latest.name'], { ns: 'plugin' }),
    },
  ]
  const scopeOptions = [
    {
      value: AUTO_UPDATE_MODE.update_all,
      label: t(($) => $['autoUpdate.scopeMode.all'], { ns: 'plugin' }),
    },
    {
      value: AUTO_UPDATE_MODE.exclude,
      label: t(($) => $['autoUpdate.scopeMode.exclude'], { ns: 'plugin' }),
    },
    {
      value: AUTO_UPDATE_MODE.partial,
      label: t(($) => $['autoUpdate.upgradeMode.partial'], { ns: 'plugin' }),
    },
  ]
  const [previewStrategy, setPreviewStrategy] = useState<AUTO_UPDATE_STRATEGY>()
  const displayedStrategy = previewStrategy ?? autoUpgrade.strategy_setting
  const getStrategyDescription = (strategy: AUTO_UPDATE_STRATEGY) => {
    switch (strategy) {
      case AUTO_UPDATE_STRATEGY.disabled:
        return t(($) => $['autoUpdate.strategy.disabled.description'], { ns: 'plugin' })
      case AUTO_UPDATE_STRATEGY.fixOnly:
        return t(($) => $['autoUpdate.strategy.fixOnly.description'], { ns: 'plugin' })
      case AUTO_UPDATE_STRATEGY.latest:
        return t(($) => $['autoUpdate.strategy.latest.description'], { ns: 'plugin' })
      default:
        return ''
    }
  }
  const strategyDescription = getStrategyDescription(displayedStrategy)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSave(autoUpgrade)
      }}
    >
      <div className="flex w-full flex-col gap-4 px-6 py-3">
        <div className="flex w-full flex-col items-start gap-1">
          <div className="flex w-full flex-col items-start gap-1">
            <div className={updateSettingFormLabelClassName}>
              {t(($) => $['autoUpdate.autoUpdate'], { ns: 'plugin' })}
            </div>
            <RadioGroup<AUTO_UPDATE_STRATEGY>
              aria-label={t(($) => $['autoUpdate.autoUpdate'], { ns: 'plugin' })}
              className="flex w-full gap-2"
              value={autoUpgrade.strategy_setting}
              onValueChange={(strategy_setting) => onAutoUpgradeChange({ strategy_setting })}
            >
              {strategyOptions.map((option) => (
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
            <div className="w-full body-xs-regular text-text-tertiary">{strategyDescription}</div>
          </div>
        </div>
        {autoUpgrade.strategy_setting !== AUTO_UPDATE_STRATEGY.disabled && (
          <>
            <div className="h-px w-full bg-divider-subtle" />
            <div className="flex w-full flex-col items-start gap-1">
              <TimePicker
                timeZone={timezone}
                value={updateTimeValue}
                onValueChange={onUpdateTimeChange}
                minuteStep={15}
              >
                <div className="flex w-full items-center gap-2">
                  <TimePickerLabel
                    className={cn(updateSettingFormLabelClassName, 'min-w-0 flex-1')}
                  >
                    {t(($) => $['autoUpdate.updateTime'], { ns: 'plugin' })}
                  </TimePickerLabel>
                  <div className="body-xs-regular text-text-tertiary">
                    <Trans
                      i18nKey={($) => $['autoUpdate.changeTimezone']}
                      ns="plugin"
                      components={{
                        setTimezone: <SettingTimeZone />,
                      }}
                    />
                  </div>
                </div>
                <TimePickerTrigger className="w-full px-2">
                  <span aria-hidden="true" className="i-ri-time-line size-4 text-text-tertiary" />
                  <TimePickerValue className="flex min-w-0 flex-1 items-center justify-between gap-1">
                    {(displayValue) => (
                      <>
                        <span>{displayValue}</span>
                        <span className="text-text-tertiary">
                          {convertTimezoneToOffsetStr(timezone)}
                        </span>
                      </>
                    )}
                  </TimePickerValue>
                </TimePickerTrigger>
                <TimePickerContent />
              </TimePicker>
            </div>
            <div className="flex w-full flex-col items-start gap-2">
              <div className="flex h-15 w-full flex-col items-start gap-1">
                <div className={updateSettingFormLabelClassName}>
                  {t(($) => $['autoUpdate.scope'], { ns: 'plugin' })}
                </div>
                <RadioGroup<AUTO_UPDATE_MODE>
                  aria-label={t(($) => $['autoUpdate.scope'], { ns: 'plugin' })}
                  className="flex w-full gap-2"
                  value={autoUpgrade.upgrade_mode}
                  onValueChange={(upgrade_mode) => onAutoUpgradeChange({ upgrade_mode })}
                >
                  {scopeOptions.map((option) => (
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
      <div className="flex h-19 items-center justify-end gap-2 px-6 pt-5 pb-6">
        <DialogClose render={<Button variant="secondary" className="min-w-18" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" variant="primary" className="min-w-18" disabled={isSavePending}>
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </div>
    </form>
  )
}
