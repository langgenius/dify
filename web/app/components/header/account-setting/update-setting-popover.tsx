'use client'

import type { AutoUpdateConfig } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import type { ReferenceSetting } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { convertTimezoneToOffsetStr } from '@/app/components/base/date-and-time-picker/utils/dayjs'
import { defaultValue as defaultAutoUpdateValue } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/config'
import PluginsPicker from '@/app/components/plugins/reference-setting-modal/auto-update-setting/plugins-picker'
import { AUTO_UPDATE_MODE, AUTO_UPDATE_STRATEGY } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import { convertUTCDaySecondsToLocalSeconds, timeOfDayToDayjs } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/utils'
import { useAppContext } from '@/context/app-context'

type Props = {
  defaultStrategy?: AUTO_UPDATE_STRATEGY
  referenceSetting: ReferenceSetting
  onSave: (payload: ReferenceSetting) => void
}

type SegmentedOption<T extends string> = {
  label: string
  value: T
}

const updateSettingFormClassName = 'flex flex-col items-start gap-1 pb-1 pt-0.5'
const updateSettingFormInputSetClassName = 'flex flex-col items-start gap-0.5 px-4 py-1'
const updateSettingFormLabelClassName = 'flex min-h-6 items-center system-sm-semibold text-text-secondary'

const getAutoUpgrade = (
  referenceSetting: ReferenceSetting,
  defaultStrategy: AUTO_UPDATE_STRATEGY,
): AutoUpdateConfig => ({
  ...defaultAutoUpdateValue,
  ...referenceSetting.auto_upgrade,
  strategy_setting: referenceSetting.auto_upgrade?.strategy_setting ?? defaultStrategy,
  exclude_plugins: referenceSetting.auto_upgrade?.exclude_plugins ?? defaultAutoUpdateValue.exclude_plugins,
  include_plugins: referenceSetting.auto_upgrade?.include_plugins ?? defaultAutoUpdateValue.include_plugins,
})

const SegmentedControl = <T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string
  options: Array<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
}) => {
  return (
    <div
      aria-label={ariaLabel}
      className="inline-flex items-center gap-px rounded-[10px] bg-components-segmented-control-bg-normal p-0.5"
      role="radiogroup"
    >
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={cn(
            'flex items-center justify-center rounded-lg px-2 py-1 system-sm-medium text-text-secondary hover:bg-state-base-hover-alt',
            value === option.value && 'border-[0.5px] border-components-segmented-control-item-active-border bg-components-segmented-control-item-active-bg text-text-accent-light-mode-only shadow-xs hover:bg-components-segmented-control-item-active-bg',
          )}
          onClick={() => onChange(option.value)}
        >
          <span className="p-0.5 whitespace-nowrap">{option.label}</span>
        </button>
      ))}
    </div>
  )
}

const UpdateSettingPopover = ({
  defaultStrategy = AUTO_UPDATE_STRATEGY.fixOnly,
  referenceSetting,
  onSave,
}: Props) => {
  const { t } = useTranslation()
  const { userProfile } = useAppContext()
  const timezone = userProfile.timezone || 'UTC'
  const [autoUpgrade, setAutoUpgrade] = useState(() => getAutoUpgrade(referenceSetting, defaultStrategy))
  const localUpdateTime = timeOfDayToDayjs(convertUTCDaySecondsToLocalSeconds(autoUpgrade.upgrade_time_of_day, timezone))
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
  const selectedStrategyLabel = getStrategyLabel(autoUpgrade.strategy_setting)
  const plugins = useMemo(() => {
    switch (autoUpgrade.upgrade_mode) {
      case AUTO_UPDATE_MODE.partial:
        return autoUpgrade.include_plugins
      case AUTO_UPDATE_MODE.exclude:
        return autoUpgrade.exclude_plugins
      default:
        return []
    }
  }, [autoUpgrade.exclude_plugins, autoUpgrade.include_plugins, autoUpgrade.upgrade_mode])
  const strategyOptions = useMemo<Array<SegmentedOption<AUTO_UPDATE_STRATEGY>>>(() => [
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
  const scopeOptions = useMemo<Array<SegmentedOption<AUTO_UPDATE_MODE>>>(() => [
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
    const nextAutoUpgrade = {
      ...autoUpgrade,
      ...payload,
    }
    setAutoUpgrade(nextAutoUpgrade)
    onSave({
      ...referenceSetting,
      auto_upgrade: nextAutoUpgrade,
    })
  }, [autoUpgrade, onSave, referenceSetting])

  const handlePluginsChange = useCallback((newPlugins: string[]) => {
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
  }, [autoUpgrade.upgrade_mode, updateAutoUpgrade])

  return (
    <Popover>
      <PopoverTrigger
        render={(
          <Button
            variant="secondary"
            className="h-8 gap-0.5 px-3 system-sm-medium"
          >
            <span aria-hidden className="i-ri-flashlight-line size-4" />
            <span className="px-0.5">{t('modelProvider.updateSetting', { ns: 'common' })}</span>
            <span className="flex min-w-4 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
              {selectedStrategyLabel}
            </span>
            <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
          </Button>
        )}
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="w-[240px] overflow-hidden rounded-2xl border-t border-components-panel-border bg-components-panel-bg p-0 shadow-xl"
      >
        <div className="border-b-[0.5px] border-black/5 py-2">
          <div className={cn(updateSettingFormClassName, 'w-full')}>
            <div className={updateSettingFormInputSetClassName}>
              <div className={updateSettingFormLabelClassName}>
                {t('autoUpdate.automaticUpdates', { ns: 'plugin' })}
              </div>
              <SegmentedControl
                ariaLabel={t('autoUpdate.automaticUpdates', { ns: 'plugin' })}
                options={strategyOptions}
                value={autoUpgrade.strategy_setting}
                onChange={strategy_setting => updateAutoUpgrade({ strategy_setting })}
              />
            </div>
          </div>
          {autoUpgrade.strategy_setting !== AUTO_UPDATE_STRATEGY.disabled && (
            <>
              <div className={updateSettingFormClassName}>
                <div className={updateSettingFormInputSetClassName}>
                  <div className={updateSettingFormLabelClassName}>
                    {t('autoUpdate.updateTime', { ns: 'plugin' })}
                  </div>
                  <div className="flex w-fit cursor-default items-center justify-center gap-0.5 rounded-lg bg-[#f5f4ee] px-3 py-2 shadow-xs backdrop-blur-[5px]">
                    <span aria-hidden className="i-ri-time-line size-4 shrink-0 text-components-button-secondary-text" />
                    <span className="px-0.5 system-sm-medium text-components-button-secondary-text">
                      {localUpdateTime.format('hh:mm A')}
                      {' '}
                      {convertTimezoneToOffsetStr(timezone)}
                    </span>
                  </div>
                </div>
              </div>
              <div className={cn(updateSettingFormClassName, 'w-full')}>
                <div className={cn(updateSettingFormInputSetClassName, 'w-full')}>
                  <div className={updateSettingFormLabelClassName}>
                    {t('autoUpdate.scope', { ns: 'plugin' })}
                  </div>
                  <SegmentedControl
                    ariaLabel={t('autoUpdate.scope', { ns: 'plugin' })}
                    options={scopeOptions}
                    value={autoUpgrade.upgrade_mode}
                    onChange={upgrade_mode => updateAutoUpgrade({ upgrade_mode })}
                  />
                  {autoUpgrade.upgrade_mode !== AUTO_UPDATE_MODE.update_all && (
                    <PluginsPicker
                      value={plugins}
                      onChange={handlePluginsChange}
                      updateMode={autoUpgrade.upgrade_mode}
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default UpdateSettingPopover
