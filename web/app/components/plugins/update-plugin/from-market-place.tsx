'use client'
import type { UpdateFromMarketPlacePayload } from '../types'
import { AlertDialog, AlertDialogContent } from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useIsMutating, useMutation } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge/index'
import Card from '@/app/components/plugins/card'
import checkTaskStatus from '@/app/components/plugins/install-plugin/base/check-task-status'
import { pluginManifestToCardPluginProps } from '@/app/components/plugins/install-plugin/utils'
import { toast } from '@/app/notifications'
import { consoleClient } from '@/service/console'
import { usePluginTaskList, useRemoveAutoUpgrade } from '@/service/use-plugins'
import useGetIcon from '../install-plugin/base/use-get-icon'
import { TaskStatus } from '../types'
import DowngradeWarningContent from './downgrade-warning'

const i18nPrefix = 'upgrade'

type Props = Readonly<{
  payload: UpdateFromMarketPlacePayload
  pluginId: string
  onRefresh: () => void | Promise<void>
  onSuccess: () => void
  warnAboutAutoUpdate?: boolean
}>

const updateMutationKey = (payload: UpdateFromMarketPlacePayload) => [
  'plugin-marketplace-update',
  payload.originalPackageInfo.id,
  payload.targetPackageInfo.id,
]

const UpdateFromMarketplaceContent = ({
  payload,
  pluginId,
  onRefresh,
  onSuccess,
  warnAboutAutoUpdate,
}: Props) => {
  const { originalPackageInfo, targetPackageInfo } = payload
  const { t } = useTranslation(['common', 'plugin'])
  const upgradeButtonLabelId = React.useId()
  const { getIconUrl } = useGetIcon()
  const icon = getIconUrl(originalPackageInfo.payload.icon)
  const { check } = checkTaskStatus()

  const { handleInstallTaskStart } = usePluginTaskList(payload.category)
  const exclude = useRemoveAutoUpgrade()
  const upgrade = useMutation({
    mutationKey: updateMutationKey(payload),
    // One operation owns exclusion, package replacement, and task completion.
    mutationFn: async (excludeFromAutoUpdate: boolean) => {
      if (excludeFromAutoUpdate)
        await exclude.mutateAsync({ plugin_id: pluginId, category: payload.category })
      const response = await consoleClient.workspaces.current.plugin.upgrade.marketplace.post({
        body: {
          original_plugin_unique_identifier: originalPackageInfo.id,
          new_plugin_unique_identifier: targetPackageInfo.id,
        },
      })
      if (response.task?.status === TaskStatus.failed) {
        const failedPlugin =
          response.task.plugins?.find(
            (plugin) => plugin.plugin_unique_identifier === targetPackageInfo.id,
          ) ?? response.task.plugins?.[0]
        const message = failedPlugin?.message || t(($) => $.error, { ns: 'common' })
        toast.error(message)
        throw new Error(message)
      }
      if (!response.all_installed) {
        handleInstallTaskStart(response)
        const { status, error } = await check({
          taskId: response.task_id,
          pluginUniqueIdentifier: targetPackageInfo.id,
        })
        if (status === TaskStatus.failed) {
          const message = error || t(($) => $.error, { ns: 'common' })
          toast.error(message)
          throw new Error(message)
        }
      }
    },
    onSuccess: onRefresh,
  })
  const handleConfirm = () => upgrade.mutate(false, { onSuccess })
  const handleExcludeAndDowngrade = () => upgrade.mutate(true, { onSuccess })
  const configBtnText = upgrade.isPending
    ? t(($) => $['upgrade.upgrading'], { ns: 'plugin' })
    : t(($) => $['upgrade.upgrade'], { ns: 'plugin' })

  return (
    <>
      {warnAboutAutoUpdate && (
        <DowngradeWarningContent
          onJustDowngrade={handleConfirm}
          onExcludeAndDowngrade={handleExcludeAndDowngrade}
          excluding={upgrade.isPending && upgrade.variables === true}
          downgrading={upgrade.isPending && upgrade.variables === false}
        />
      )}
      {!warnAboutAutoUpdate && (
        <>
          <DialogHeader>
            <DialogTitle>{t(($) => $[`${i18nPrefix}.title`], { ns: 'plugin' })}</DialogTitle>
            <DialogHeaderCloseButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            />
          </DialogHeader>
          <DialogBody>
            <div className="mb-2 system-md-regular text-text-secondary">
              {t(($) => $[`${i18nPrefix}.description`], { ns: 'plugin' })}
            </div>
            <div className="flex flex-wrap content-start items-start gap-1 self-stretch rounded-2xl bg-background-section-burn p-2">
              <Card
                installed={upgrade.isSuccess}
                payload={pluginManifestToCardPluginProps({
                  ...originalPackageInfo.payload,
                  icon,
                })}
                className="w-full"
                titleLeft={
                  <>
                    <Badge className="mx-1" size="s" variant="warning">
                      {`${originalPackageInfo.payload.version} -> ${targetPackageInfo.version}`}
                    </Badge>
                  </>
                }
              />
            </div>
          </DialogBody>
          <DialogFooter>
            {!upgrade.isPending && (
              <DialogClose render={<Button />}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </DialogClose>
            )}
            <Button
              variant="primary"
              loading={upgrade.isPending}
              onClick={handleConfirm}
              aria-labelledby={upgradeButtonLabelId}
            >
              <span id={upgradeButtonLabelId}>{configBtnText}</span>
            </Button>
          </DialogFooter>
        </>
      )}
    </>
  )
}
type MarketplaceUpdateDialogProps = Omit<Props, 'onSuccess' | 'warnAboutAutoUpdate'> & {
  open: boolean
  onClose: () => void
  warnAboutAutoUpdate?: boolean
}

export default function MarketplaceUpdateDialog({
  open,
  onClose,
  warnAboutAutoUpdate = false,
  ...session
}: MarketplaceUpdateDialogProps) {
  const pending = useIsMutating({ mutationKey: updateMutationKey(session.payload) }) > 0
  return (
    <>
      <Dialog
        open={open && !warnAboutAutoUpdate}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onClose()
        }}
      >
        <DialogContent className="w-140" backdropProps={{ forceRender: true }}>
          <UpdateFromMarketplaceContent {...session} onSuccess={onClose} />
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={open && warnAboutAutoUpdate}
        onOpenChange={(nextOpen, details) => {
          if (!nextOpen && pending) details.cancel()
          else if (!nextOpen) onClose()
        }}
      >
        <AlertDialogContent className="w-160" backdropProps={{ forceRender: true }}>
          <UpdateFromMarketplaceContent {...session} warnAboutAutoUpdate onSuccess={onClose} />
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
