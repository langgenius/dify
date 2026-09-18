'use client'
import type {
  TimePickerProps,
  TriggerParams,
} from '@/app/components/base/date-and-time-picker/types'
import type { AutoUpdateConfig } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import type { PluginCategoryEnum } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { convertTimezoneToOffsetStr } from '@/app/components/base/date-and-time-picker/utils/dayjs'
import {
  AUTO_UPDATE_MODE,
  AUTO_UPDATE_STRATEGY,
} from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import {
  convertLocalSecondsToUTCDaySeconds,
  convertUTCDaySecondsToLocalSeconds,
  dayjsToTimeOfDay,
  timeOfDayToDayjs,
} from '@/app/components/plugins/reference-setting-modal/auto-update-setting/utils'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import {
  useMutationPluginAutoUpgradeSettings,
  usePluginAutoUpgradeSettings,
} from '@/service/use-plugins'
import UpdateSettingDialogForm from './update-setting-dialog-form'

type Props = {
  category: PluginCategoryEnum
  disabled?: boolean
}

const UpdateSettingDialog = ({ category, disabled = false }: Props) => {
  const { t } = useTranslation()
  const { data: timezone } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.timezone || 'UTC',
  })
  const {
    data: autoUpgradeSetting,
    error,
    isFetching,
    isLoading,
  } = usePluginAutoUpgradeSettings(category)
  const { mutate: saveAutoUpgrade, isPending: isSavePending } =
    useMutationPluginAutoUpgradeSettings({
      category,
      onSuccess: () => {
        toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }))
      },
    })
  const savedAutoUpgrade = autoUpgradeSetting?.auto_upgrade
  const [isOpen, setIsOpen] = useState(false)
  const [draftAutoUpgrade, setDraftAutoUpgrade] = useState<AutoUpdateConfig>()
  const isSettingsLoading = !savedAutoUpgrade && !error && (isLoading || isFetching)
  const autoUpgrade = draftAutoUpgrade ?? savedAutoUpgrade
  const hasSettings = !!autoUpgrade
  const getStrategyLabel = useCallback(
    (strategy: AUTO_UPDATE_STRATEGY) => {
      switch (strategy) {
        case AUTO_UPDATE_STRATEGY.disabled:
          return t(($) => $['autoUpdate.strategy.disabled.name'], { ns: 'plugin' })
        case AUTO_UPDATE_STRATEGY.fixOnly:
          return t(($) => $['autoUpdate.strategy.fixOnly.name'], { ns: 'plugin' })
        case AUTO_UPDATE_STRATEGY.latest:
          return t(($) => $['autoUpdate.strategy.latest.name'], { ns: 'plugin' })
        default:
          return ''
      }
    },
    [t],
  )
  const selectedStrategyLabel = autoUpgrade ? getStrategyLabel(autoUpgrade.strategy_setting) : ''
  const plugins = useMemo(() => {
    if (!autoUpgrade) return []

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
    if (!autoUpgrade) return ''

    const localSeconds = convertUTCDaySecondsToLocalSeconds(
      autoUpgrade.upgrade_time_of_day,
      timezone,
    )
    return timeOfDayToDayjs(localSeconds).format('HH:mm')
  }, [autoUpgrade, timezone])
  const strategyOptions = useMemo(
    () => [
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
    ],
    [getStrategyLabel],
  )
  const scopeOptions = useMemo(
    () => [
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
    ],
    [t],
  )

  const updateAutoUpgrade = useCallback(
    (payload: Partial<AutoUpdateConfig>) => {
      setDraftAutoUpgrade((currentAutoUpgrade) => {
        const baseAutoUpgrade = currentAutoUpgrade ?? savedAutoUpgrade
        if (!baseAutoUpgrade) return undefined

        return {
          ...baseAutoUpgrade,
          ...payload,
        }
      })
    },
    [savedAutoUpgrade],
  )

  const handlePluginsChange = useCallback(
    (newPlugins: string[]) => {
      if (!autoUpgrade) return

      if (autoUpgrade.upgrade_mode === AUTO_UPDATE_MODE.partial) {
        updateAutoUpgrade({
          include_plugins: newPlugins,
        })
      } else if (autoUpgrade.upgrade_mode === AUTO_UPDATE_MODE.exclude) {
        updateAutoUpgrade({
          exclude_plugins: newPlugins,
        })
      }
    },
    [autoUpgrade, updateAutoUpgrade],
  )
  const minuteFilter = useCallback((minutes: string[]) => {
    return minutes.filter((m) => {
      const time = Number.parseInt(m, 10)
      return time % 15 === 0
    })
  }, [])
  const handleUpdateTimeChange = useCallback(
    (value: Parameters<typeof dayjsToTimeOfDay>[0]) => {
      updateAutoUpgrade({
        upgrade_time_of_day: convertLocalSecondsToUTCDaySeconds(dayjsToTimeOfDay(value), timezone),
      })
    },
    [timezone, updateAutoUpgrade],
  )
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (disabled) {
        setIsOpen(false)
        return
      }

      setIsOpen(open)
      if (open) setDraftAutoUpgrade(savedAutoUpgrade)
      else setDraftAutoUpgrade(undefined)
    },
    [disabled, savedAutoUpgrade],
  )
  const handleCancel = useCallback(() => {
    setDraftAutoUpgrade(undefined)
    setIsOpen(false)
  }, [])
  const handleSave = useCallback(() => {
    if (!autoUpgrade) return

    saveAutoUpgrade(autoUpgrade)
    setDraftAutoUpgrade(undefined)
    setIsOpen(false)
  }, [autoUpgrade, saveAutoUpgrade])
  const renderTimePickerTrigger = useCallback<NonNullable<TimePickerProps['renderTrigger']>>(
    (props, state, { inputElem, onClick }: TriggerParams) => {
      return (
        <button
          {...props}
          type="button"
          className={cn(
            'group flex h-8 w-full cursor-pointer items-center gap-1 rounded-lg border-none bg-components-input-bg-normal px-2 py-1 text-left shadow-none hover:bg-state-base-hover-alt focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden',
            props.className,
          )}
          onClick={(event) => {
            onClick(event)
            props.onClick?.(event)
          }}
        >
          <span
            aria-hidden
            className={cn(
              'i-ri-time-line size-4 shrink-0 text-text-tertiary',
              state.open ? 'text-text-secondary' : 'group-hover:text-text-secondary',
            )}
          />
          <span className="min-w-0 flex-1 p-1 system-sm-regular text-components-input-text-filled">
            {inputElem}
          </span>
          <span className="shrink-0 pr-0.5 system-sm-regular text-text-tertiary">
            {convertTimezoneToOffsetStr(timezone)}
          </span>
        </button>
      )
    },
    [timezone],
  )

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="secondary" className="h-8 system-sm-medium" disabled={disabled}>
            <span aria-hidden className="i-custom-vender-system-auto-update-line size-4" />
            <span>{t(($) => $['autoUpdate.autoUpdate'], { ns: 'plugin' })}</span>
            {selectedStrategyLabel && (
              <span className="flex min-w-4 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
                {selectedStrategyLabel}
              </span>
            )}
          </Button>
        }
      />
      {!disabled && (
        <DialogContent className="flex w-120 max-w-[calc(100vw-32px)] flex-col overflow-hidden! rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-0! text-left align-middle shadow-xl">
          <div className="relative flex w-full items-start gap-2 px-6 pt-6 pr-14 pb-3">
            <DialogTitle className="min-w-0 flex-1 title-2xl-semi-bold text-text-primary">
              {t(($) => $['autoUpdate.autoUpdateSettings'], { ns: 'plugin' })}
            </DialogTitle>
            <DialogClose
              render={
                <IconButton
                  aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                  size="lg"
                  className="absolute top-5 right-5"
                >
                  <span aria-hidden className="i-ri-close-line size-4" />
                </IconButton>
              }
            />
          </div>
          {isSettingsLoading && (
            <div
              role="status"
              className="flex min-h-65 items-center justify-center gap-2 px-6 py-6 system-sm-regular text-text-tertiary"
            >
              <span
                aria-hidden
                className="i-ri-loader-2-line size-4 animate-spin motion-reduce:animate-none"
              />
              <span>{t(($) => $.loading, { ns: 'common' })}</span>
            </div>
          )}
          {!isSettingsLoading && !hasSettings && (
            <div className="flex min-h-65 items-center justify-center px-6 py-6 text-center system-sm-regular text-text-tertiary">
              {t(($) => $['api.actionFailed'], { ns: 'common' })}
            </div>
          )}
          {!isSettingsLoading && hasSettings && autoUpgrade && (
            <>
              <UpdateSettingDialogForm
                autoUpgrade={autoUpgrade}
                category={category}
                plugins={plugins}
                scopeOptions={scopeOptions}
                strategyOptions={strategyOptions}
                timezone={timezone}
                updateTimeValue={updateTimeValue}
                minuteFilter={minuteFilter}
                onAutoUpgradeChange={updateAutoUpgrade}
                onPluginsChange={handlePluginsChange}
                onRequestClose={handleCancel}
                onUpdateTimeChange={handleUpdateTimeChange}
                renderTimePickerTrigger={renderTimePickerTrigger}
              />
              <div className="flex h-19 items-center justify-end gap-2 px-6 pt-5 pb-6">
                <Button variant="secondary" className="min-w-18" onClick={handleCancel}>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </Button>
                <Button
                  variant="primary"
                  className="min-w-18"
                  onClick={handleSave}
                  disabled={isSavePending}
                >
                  {t(($) => $['operation.save'], { ns: 'common' })}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      )}
    </Dialog>
  )
}

export default UpdateSettingDialog
