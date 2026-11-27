'use client'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { UseQueryResult } from '@tanstack/react-query'
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
import { useQuery } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AUTO_UPDATE_STRATEGY } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useMutationPluginAutoUpgradeSettings } from '@/service/use-plugins'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { UpdateSettingDialogForm } from './update-setting-dialog-form'

type Props = {
  category: PluginCategoryEnum
}

export function UpdateSettingDialog({ category }: Props) {
  const actionsRef = useRef<DialogActions>(null)
  const { t } = useTranslation(['common', 'plugin'])
  const autoUpgradeSettingQuery = useQuery(
    consoleQuery.workspaces.current.plugin.autoUpgrade.fetch.get.queryOptions({
      input: { query: { category } },
    }),
  )
  const { mutate: saveAutoUpgrade, isPending: isSavePending } =
    useMutationPluginAutoUpgradeSettings({
      category,
      onSuccess: () => {
        toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }))
        actionsRef.current?.close()
      },
    })
  const { data: autoUpgradeSetting, error, isFetching, isLoading } = autoUpgradeSettingQuery
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
  }

  return (
    <Dialog
      actionsRef={actionsRef}
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (!open && isSavePending && details.reason !== 'imperative-action') details.cancel()
      }}
    >
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(($) => $['autoUpdate.autoUpdateSettings'], { ns: 'plugin' })}
          </DialogTitle>
          <DialogHeaderCloseButton
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            disabled={isSavePending}
          />
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
          <SettingsLoadError query={autoUpgradeSettingQuery} />
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

/** Mounted only inside the open dialog, so a failed load is claimed only while it is shown. */
function SettingsLoadError({ query }: { query: UseQueryResult<unknown> }) {
  const { t } = useTranslation(['common'])
  const settingsLoad = useOwnedQueryError(query)
  const fallback = t(($) => $['api.actionFailed'], { ns: 'common' })
  const settingsErrorMessage = useRequestErrorMessage(settingsLoad?.error, fallback)

  return (
    <DialogBody>
      <div
        role="alert"
        className="flex min-h-65 flex-col items-center justify-center gap-3 text-center system-sm-regular text-text-tertiary"
      >
        <span>{settingsErrorMessage ?? fallback}</span>
        <Button size="small" loading={query.isFetching} onClick={() => void query.refetch()}>
          {t(($) => $['operation.retry'], { ns: 'common' })}
        </Button>
      </div>
    </DialogBody>
  )
}
