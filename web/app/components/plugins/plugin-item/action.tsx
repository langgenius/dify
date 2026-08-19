'use client'
import type { FC } from 'react'
import type { MetaData } from '../types'
import type { PluginCategoryEnum } from '@/app/components/plugins/types'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '@/context/modal-context'
import { uninstallPlugin } from '@/service/plugins'
import { useInvalidateInstalledPluginList } from '@/service/use-plugins'
import { checkForUpdates, fetchReleases } from '../install-plugin/hooks'
import PluginInfo from '../plugin-page/plugin-info'
import { PluginSource } from '../types'

const i18nPrefix = 'action'

type Props = Readonly<{
  author: string
  installationId: string
  pluginUniqueIdentifier: string
  pluginName: string
  category: PluginCategoryEnum
  usedInApps: number
  isShowFetchNewVersion: boolean
  isShowInfo: boolean
  isShowDelete: boolean
  onDelete: () => void
  meta?: MetaData
}>
const Action: FC<Props> = ({
  author,
  installationId,
  pluginUniqueIdentifier,
  pluginName,
  category,
  isShowFetchNewVersion,
  isShowInfo,
  isShowDelete,
  onDelete,
  meta,
}) => {
  const { t } = useTranslation()
  const [isShowPluginInfo, { setTrue: showPluginInfo, setFalse: hidePluginInfo }] =
    useBoolean(false)
  const [deleting, { setTrue: showDeleting, setFalse: hideDeleting }] = useBoolean(false)
  const { setShowUpdatePluginModal } = useModalContext()
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()

  const handleFetchNewVersion = async () => {
    const owner = meta!.repo.split('/')[0] || author
    const repo = meta!.repo.split('/')[1] || pluginName
    const fetchedReleases = await fetchReleases(owner, repo)
    if (fetchedReleases.length === 0) return
    const { needUpdate, toastProps } = checkForUpdates(fetchedReleases, meta!.version)
    toast(toastProps.message, { type: toastProps.type })
    if (needUpdate) {
      setShowUpdatePluginModal({
        onSaveCallback: () => {
          invalidateInstalledPluginList(category)
        },
        payload: {
          type: PluginSource.github,
          category,
          github: {
            originalPackageInfo: {
              id: pluginUniqueIdentifier,
              repo: meta!.repo,
              version: meta!.version,
              package: meta!.package,
              releases: fetchedReleases,
            },
          },
        },
      })
    }
  }

  const [isShowDeleteConfirm, { setTrue: showDeleteConfirm, setFalse: hideDeleteConfirm }] =
    useBoolean(false)

  const handleDelete = useCallback(async () => {
    showDeleting()
    try {
      const res = await uninstallPlugin(installationId)
      if (res.success) {
        hideDeleteConfirm()
        invalidateInstalledPluginList(category)
        onDelete()
      }
    } catch (error) {
      console.error('uninstallPlugin error', error)
    } finally {
      hideDeleting()
    }
  }, [
    hideDeleteConfirm,
    hideDeleting,
    installationId,
    category,
    invalidateInstalledPluginList,
    onDelete,
    showDeleting,
  ])
  return (
    <div className="flex space-x-1">
      {/* Only plugin installed from GitHub need to check if it's the new version  */}
      {isShowFetchNewVersion && (
        <Tooltip>
          <TooltipTrigger
            render={
              <IconButton
                aria-label={t(($) => $[`${i18nPrefix}.checkForUpdates`], { ns: 'plugin' })}
                onClick={handleFetchNewVersion}
              >
                <span aria-hidden className="i-ri-loop-left-line size-4 text-text-tertiary" />
              </IconButton>
            }
          />
          <TooltipContent>
            {t(($) => $[`${i18nPrefix}.checkForUpdates`], { ns: 'plugin' })}
          </TooltipContent>
        </Tooltip>
      )}
      {isShowInfo && (
        <Tooltip>
          <TooltipTrigger
            render={
              <IconButton
                aria-label={t(($) => $[`${i18nPrefix}.pluginInfo`], { ns: 'plugin' })}
                onClick={showPluginInfo}
              >
                <span aria-hidden className="i-ri-information-2-line size-4 text-text-tertiary" />
              </IconButton>
            }
          />
          <TooltipContent>
            {t(($) => $[`${i18nPrefix}.pluginInfo`], { ns: 'plugin' })}
          </TooltipContent>
        </Tooltip>
      )}
      {isShowDelete && (
        <Tooltip>
          <TooltipTrigger
            render={
              <IconButton
                aria-label={t(($) => $[`${i18nPrefix}.delete`], { ns: 'plugin' })}
                tone="destructive"
                onClick={showDeleteConfirm}
              >
                <span aria-hidden className="i-ri-delete-bin-line size-4" />
              </IconButton>
            }
          />
          <TooltipContent>{t(($) => $[`${i18nPrefix}.delete`], { ns: 'plugin' })}</TooltipContent>
        </Tooltip>
      )}

      {isShowPluginInfo && (
        <PluginInfo
          repository={meta!.repo}
          release={meta!.version}
          packageName={meta!.package}
          onHide={hidePluginInfo}
        />
      )}
      <AlertDialog open={isShowDeleteConfirm} onOpenChange={(open) => !open && hideDeleteConfirm()}>
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t(($) => $[`${i18nPrefix}.delete`], { ns: 'plugin' })}
            </AlertDialogTitle>
            <div className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t(($) => $[`${i18nPrefix}.deleteContentLeft`], { ns: 'plugin' })}
              <span className="system-md-semibold">{pluginName}</span>
              {t(($) => $[`${i18nPrefix}.deleteContentRight`], { ns: 'plugin' })}
              <br />
            </div>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={deleting} disabled={deleting} onClick={handleDelete}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
export default React.memo(Action)
