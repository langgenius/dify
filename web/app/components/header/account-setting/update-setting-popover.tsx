'use client'

import type { ReactNode } from 'react'
import type { TriggerParams } from '@/app/components/base/date-and-time-picker/types'
import type { AutoUpdateConfig } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import type { PluginCategoryEnum } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { ToggleGroup, ToggleGroupItem } from '@langgenius/dify-ui/toggle-group'
import { useCallback, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import TimePicker from '@/app/components/base/date-and-time-picker/time-picker'
import { convertTimezoneToOffsetStr } from '@/app/components/base/date-and-time-picker/utils/dayjs'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import PluginsPicker from '@/app/components/plugins/reference-setting-modal/auto-update-setting/plugins-picker'
import { AUTO_UPDATE_MODE, AUTO_UPDATE_STRATEGY } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import { convertLocalSecondsToUTCDaySeconds, convertUTCDaySecondsToLocalSeconds, dayjsToTimeOfDay, timeOfDayToDayjs } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/utils'
import { useAppContext } from '@/context/app-context'
import { useModalContextSelector } from '@/context/modal-context'
import { useMutationPluginAutoUpgradeSettings, usePluginAutoUpgradeSettings } from '@/service/use-plugins'

type Props = {
  category: PluginCategoryEnum
  disabled?: boolean
}

const updateSettingFormClassName = 'flex flex-col items-start gap-1 pb-1 pt-0.5'
const updateSettingFormInputSetClassName = 'flex flex-col items-start gap-0.5 px-4 py-1'
const updateSettingFormLabelClassName = 'flex min-h-6 items-center system-sm-semibold text-text-secondary'
const updateSettingToggleItemClassName = 'flex-1 hover:bg-state-base-hover-alt data-pressed:hover:bg-components-segmented-control-item-active-bg'

function SettingTimeZone({ children }: { children?: ReactNode }) {
  const setShowAccountSettingModal = useModalContextSelector(s => s.setShowAccountSettingModal)

  return (
    <button
      type="button"
      className="cursor-pointer border-none bg-transparent p-0 text-left body-xs-regular text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
      onClick={() => setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.LANGUAGE })}
    >
      {children}
    </button>
  )
}

const UpdateSettingPopover = ({
  category,
  disabled = false,
}: Props) => {
  const { t } = useTranslation()
  const { userProfile } = useAppContext()
  const timezone = userProfile.timezone || 'UTC'
  const {
    data: autoUpgradeSetting,
    error,
    isFetching,
    isLoading,
  } = usePluginAutoUpgradeSettings(category)
  const { mutate: saveAutoUpgrade, isPending: isSavePending } = useMutationPluginAutoUpgradeSettings({
    category,
    onSuccess: () => {
      toast.success(t('api.actionSuccess', { ns: 'common' }))
    },
  })
  const savedAutoUpgrade = autoUpgradeSetting?.auto_upgrade
  const [isOpen, setIsOpen] = useState(false)
  const [draftAutoUpgrade, setDraftAutoUpgrade] = useState<AutoUpdateConfig>()
  const autoUpgrade = draftAutoUpgrade ?? savedAutoUpgrade
  const hasSettings = !!autoUpgrade
  const isSettingsLoading = !hasSettings && !error && (isLoading || isFetching)
  const getStrategyLabel = useCallback((strategy: AUTO_UPDATE_STRATEGY) => {
    switch (strategy) {
      case AUTO_UPDATE_STRATEGY.disabled:
        return t('autoUpdate.strategy.disabled.name', { ns: 'plugin' })
      case AUTO_UPDATE_STRATEGY.fixOnly:
        return t('autoUpdate.strategy.fixOnly.name', { ns: 'plugin' })
      case AUTO_UPDATE_STRATEGY.latest:
        return t('autoUpdate.strategy.latest.name', { ns: 'plugin' })
      default:
        return ''
    }
  }, [t])
  const selectedStrategyLabel = autoUpgrade ? getStrategyLabel(autoUpgrade.strategy_setting) : ''
  const plugins = useMemo(() => {
    if (!autoUpgrade)
      return []

    switch (autoUpgrade.upgrade_mode) {
      case AUTO_UPDATE_MODE.partial:
        return autoUpgrade.include_plugins
      case AUTO_UPDATE_MODE.exclude:
        return autoUpgrade.exclude_plugins
      default:
        return []
    }
  }, [autoUpgrade])
  const updateTimeValue = useMemo(() => {
    if (!autoUpgrade)
      return ''

    const localSeconds = convertUTCDaySecondsToLocalSeconds(autoUpgrade.upgrade_time_of_day, timezone)
    return timeOfDayToDayjs(localSeconds).format('HH:mm')
  }, [autoUpgrade, timezone])
  const strategyOptions = useMemo(() => [
    {
      value: AUTO_UPDATE_STRATEGY.disabled,
      label: getStrategyLabel(AUTO_UPDATE_STRATEGY.disabled),
    },
    {
      value: AUTO_UPDATE_STRATEGY.fixOnly,
      label: getStrategyLabel(AUTO_UPDATE_STRATEGY.fixOnly),
    },
    {
      value: AUTO_UPDATE_STRATEGY.latest,
      label: getStrategyLabel(AUTO_UPDATE_STRATEGY.latest),
    },
  ], [getStrategyLabel])
  const scopeOptions = useMemo(() => [
    {
      value: AUTO_UPDATE_MODE.update_all,
      label: t('autoUpdate.scopeMode.all', { ns: 'plugin' }),
    },
    {
      value: AUTO_UPDATE_MODE.exclude,
      label: t('autoUpdate.scopeMode.exclude', { ns: 'plugin' }),
    },
    {
      value: AUTO_UPDATE_MODE.partial,
      label: t('autoUpdate.scopeMode.partial', { ns: 'plugin' }),
    },
  ], [t])

  const updateAutoUpgrade = useCallback((payload: Partial<AutoUpdateConfig>) => {
    setDraftAutoUpgrade((currentAutoUpgrade) => {
      const baseAutoUpgrade = currentAutoUpgrade ?? savedAutoUpgrade
      if (!baseAutoUpgrade)
        return undefined

      return {
        ...baseAutoUpgrade,
        ...payload,
      }
    })
  }, [savedAutoUpgrade])

  const handlePluginsChange = useCallback((newPlugins: string[]) => {
    if (!autoUpgrade)
      return

    if (autoUpgrade.upgrade_mode === AUTO_UPDATE_MODE.partial) {
      updateAutoUpgrade({
        include_plugins: newPlugins,
      })
    }
    else if (autoUpgrade.upgrade_mode === AUTO_UPDATE_MODE.exclude) {
      updateAutoUpgrade({
        exclude_plugins: newPlugins,
      })
    }
  }, [autoUpgrade, updateAutoUpgrade])
  const minuteFilter = useCallback((minutes: string[]) => {
    return minutes.filter((m) => {
      const time = Number.parseInt(m, 10)
      return time % 15 === 0
    })
  }, [])
  const handleUpdateTimeChange = useCallback((value: Parameters<typeof dayjsToTimeOfDay>[0]) => {
    updateAutoUpgrade({
      upgrade_time_of_day: convertLocalSecondsToUTCDaySeconds(dayjsToTimeOfDay(value), timezone),
    })
  }, [timezone, updateAutoUpgrade])
  const handleOpenChange = useCallback((open: boolean) => {
    if (disabled) {
      setIsOpen(false)
      return
    }

    setIsOpen(open)
    if (open)
      setDraftAutoUpgrade(savedAutoUpgrade)
    else
      setDraftAutoUpgrade(undefined)
  }, [disabled, savedAutoUpgrade])
  const handleCancel = useCallback(() => {
    setDraftAutoUpgrade(undefined)
    setIsOpen(false)
  }, [])
  const handleSave = useCallback(() => {
    if (!autoUpgrade)
      return

    saveAutoUpgrade(autoUpgrade)
    setDraftAutoUpgrade(undefined)
    setIsOpen(false)
  }, [autoUpgrade, saveAutoUpgrade])
  const renderTimePickerTrigger = useCallback(({ inputElem, onClick, isOpen }: TriggerParams) => {
    return (
      <button
        type="button"
        className="group flex h-8 w-full cursor-pointer items-center justify-center rounded-lg border-none bg-components-input-bg-normal px-3 text-center shadow-xs hover:bg-state-base-hover-alt focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
        onClick={onClick}
      >
        <div className="flex min-w-0 items-center gap-1">
          <span
            aria-hidden
            className={cn(
              'i-ri-time-line size-4 shrink-0 text-text-tertiary',
              isOpen ? 'text-text-secondary' : 'group-hover:text-text-secondary',
            )}
          />
          <span className="w-[64px] min-w-[64px] text-center system-sm-medium text-components-button-secondary-text">
            {inputElem}
          </span>
          <div className="system-sm-medium text-components-button-secondary-text">{convertTimezoneToOffsetStr(timezone)}</div>
        </div>
      </button>
    )
  }, [timezone])

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={(
          <Button
            variant="secondary"
            className="h-8 gap-0.5 px-3 system-sm-medium"
            disabled={disabled}
          >
            <span aria-hidden className="i-ri-flashlight-line size-4" />
            <span className="px-0.5">{t('modelProvider.updateSetting', { ns: 'common' })}</span>
            {selectedStrategyLabel && (
              <span className="flex min-w-4 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
                {selectedStrategyLabel}
              </span>
            )}
            <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
          </Button>
        )}
      />
      {!disabled && (
        <PopoverContent
          placement="bottom-end"
          sideOffset={4}
          popupClassName="w-[518px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border-t border-components-panel-border bg-components-panel-bg p-0 shadow-xl"
        >
          {isSettingsLoading && (
            <div
              role="status"
              className="flex min-h-[96px] items-center justify-center gap-2 px-4 py-6 system-sm-regular text-text-tertiary"
            >
              <span aria-hidden className="i-ri-loader-2-line size-4 animate-spin motion-reduce:animate-none" />
              <span>{t('loading', { ns: 'common' })}</span>
            </div>
          )}
          {!isSettingsLoading && !hasSettings && (
            <div className="flex min-h-[96px] items-center justify-center px-4 py-6 text-center system-sm-regular text-text-tertiary">
              {t('api.actionFailed', { ns: 'common' })}
            </div>
          )}
          {!isSettingsLoading && hasSettings && autoUpgrade && (
            <>
              <div className="border-b-[0.5px] border-black/5 py-2">
                <div className={cn(updateSettingFormClassName, 'w-full')}>
                  <div className={cn(updateSettingFormInputSetClassName, 'w-full')}>
                    <div className={updateSettingFormLabelClassName}>
                      {t('autoUpdate.automaticUpdates', { ns: 'plugin' })}
                    </div>
                    <ToggleGroup<AUTO_UPDATE_STRATEGY>
                      aria-label={t('autoUpdate.automaticUpdates', { ns: 'plugin' })}
                      className="flex w-full"
                      value={[autoUpgrade.strategy_setting]}
                      onValueChange={(nextValue) => {
                        const strategy_setting = nextValue[0]
                        if (strategy_setting)
                          updateAutoUpgrade({ strategy_setting })
                      }}
                    >
                      {strategyOptions.map(option => (
                        <ToggleGroupItem<AUTO_UPDATE_STRATEGY>
                          key={option.value}
                          value={option.value}
                          className={updateSettingToggleItemClassName}
                        >
                          <span className="p-0.5 whitespace-nowrap">{option.label}</span>
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                </div>
                {autoUpgrade.strategy_setting !== AUTO_UPDATE_STRATEGY.disabled && (
                  <>
                    <div className={updateSettingFormClassName}>
                      <div className={cn(updateSettingFormInputSetClassName, 'w-full')}>
                        <div className={updateSettingFormLabelClassName}>
                          {t('autoUpdate.updateTime', { ns: 'plugin' })}
                        </div>
                        <div className="flex w-full flex-col items-start gap-1">
                          <TimePicker
                            value={updateTimeValue}
                            timezone={timezone}
                            onChange={handleUpdateTimeChange}
                            onClear={() => updateAutoUpgrade({
                              upgrade_time_of_day: convertLocalSecondsToUTCDaySeconds(0, timezone),
                            })}
                            title={t('autoUpdate.updateTime', { ns: 'plugin' })}
                            minuteFilter={minuteFilter}
                            renderTrigger={renderTimePickerTrigger}
                            placement="bottom-end"
                          />
                          <div className="mt-1 body-xs-regular text-text-tertiary">
                            <Trans
                              i18nKey="autoUpdate.changeTimezone"
                              ns="plugin"
                              components={{
                                setTimezone: <SettingTimeZone />,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className={cn(updateSettingFormClassName, 'w-full')}>
                      <div className={cn(updateSettingFormInputSetClassName, 'w-full')}>
                        <div className={updateSettingFormLabelClassName}>
                          {t('autoUpdate.scope', { ns: 'plugin' })}
                        </div>
                        <ToggleGroup<AUTO_UPDATE_MODE>
                          aria-label={t('autoUpdate.scope', { ns: 'plugin' })}
                          className="flex w-full"
                          value={[autoUpgrade.upgrade_mode]}
                          onValueChange={(nextValue) => {
                            const upgrade_mode = nextValue[0]
                            if (upgrade_mode)
                              updateAutoUpgrade({ upgrade_mode })
                          }}
                        >
                          {scopeOptions.map(option => (
                            <ToggleGroupItem<AUTO_UPDATE_MODE>
                              key={option.value}
                              value={option.value}
                              className={updateSettingToggleItemClassName}
                            >
                              <span className="p-0.5 whitespace-nowrap">{option.label}</span>
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                        {autoUpgrade.upgrade_mode !== AUTO_UPDATE_MODE.update_all && (
                          <PluginsPicker
                            value={plugins}
                            onChange={handlePluginsChange}
                            updateMode={autoUpgrade.upgrade_mode}
                            integrationCategory={category}
                          />
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 px-4 pt-2 pb-4">
                <Button
                  variant="secondary"
                  onClick={handleCancel}
                >
                  {t('operation.cancel', { ns: 'common' })}
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSave}
                  disabled={isSavePending}
                >
                  {t('operation.save', { ns: 'common' })}
                </Button>
              </div>
            </>
          )}
        </PopoverContent>
      )}
    </Popover>
  )
}

export default UpdateSettingPopover
