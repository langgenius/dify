'use client'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { AutoUpdateConfig } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import type { PluginCategoryEnum } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AUTO_UPDATE_STRATEGY } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import { toast } from '@/app/notifications'
import {
  useMutationPluginAutoUpgradeSettings,
  usePluginAutoUpgradeSettings,
} from '@/service/use-plugins'
import { UpdateSettingDialogForm } from './update-setting-dialog-form'

type Props = {
  category: PluginCategoryEnum
}

export function UpdateSettingDialog({ category }: Props) {
  const actionsRef = useRef<DialogActions>(null)
  const { t } = useTranslation(['common', 'plugin'])
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
  const isSettingsLoading = !savedAutoUpgrade && !error && (isLoading || isFetching)
  const getStrategyLabel = (strategy: AUTO_UPDATE_STRATEGY) => {
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
  }

  const selectedStrategyLabel = savedAutoUpgrade
    ? getStrategyLabel(savedAutoUpgrade.strategy_setting)
    : ''
  const handleSave = (autoUpgrade: AutoUpdateConfig) => {
    saveAutoUpgrade(autoUpgrade)
    actionsRef.current?.close()
  }

  return (
    <Dialog actionsRef={actionsRef}>
      <DialogTrigger
        render={
          <Button variant="secondary" className="h-8 system-sm-medium">
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
      <DialogContent className="max-w-[calc(100vw-32px)]">
        <DialogHeader>
          <DialogTitle>
            {t(($) => $['autoUpdate.autoUpdateSettings'], { ns: 'plugin' })}
          </DialogTitle>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        {isSettingsLoading && (
          <DialogBody>
            <div
              role="status"
              className="flex min-h-65 items-center justify-center gap-2 system-sm-regular text-text-tertiary"
            >
              <span
                aria-hidden
                className="i-ri-loader-2-line size-4 animate-spin motion-reduce:animate-none"
              />
              <span>{t(($) => $.loading, { ns: 'common' })}</span>
            </div>
          </DialogBody>
        )}
        {!isSettingsLoading && !savedAutoUpgrade && (
          <DialogBody>
            <div className="flex min-h-65 items-center justify-center text-center system-sm-regular text-text-tertiary">
              {t(($) => $['api.actionFailed'], { ns: 'common' })}
            </div>
          </DialogBody>
        )}
        {savedAutoUpgrade && (
          <UpdateSettingDialogForm
            initialAutoUpgrade={savedAutoUpgrade}
            category={category}
            isSavePending={isSavePending}
            onSave={handleSave}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
