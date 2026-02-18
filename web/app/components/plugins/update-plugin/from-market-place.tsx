'use client'
import type { FC } from 'react'
import type { UpdateFromMarketPlacePayload } from '../types'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Badge, { BadgeState } from '@/app/components/base/badge/index'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import Card from '@/app/components/plugins/card'
import checkTaskStatus from '@/app/components/plugins/install-plugin/base/check-task-status'
import { pluginManifestToCardPluginProps } from '@/app/components/plugins/install-plugin/utils'
import { updateFromMarketPlace } from '@/service/plugins'
import { useInvalidateReferenceSettings, usePluginTaskList, useRemoveAutoUpgrade } from '@/service/use-plugins'
import { cn } from '@/utils/classnames'
import Toast from '../../base/toast'
import useGetIcon from '../install-plugin/base/use-get-icon'
import { TaskStatus } from '../types'
import DowngradeWarningModal from './downgrade-warning'

const i18nPrefix = 'upgrade'

type Props = {
  payload: UpdateFromMarketPlacePayload
  pluginId?: string
  onSave: () => void
  onCancel: () => void
  isShowDowngradeWarningModal?: boolean
}

enum UploadStep {
  notStarted = 'notStarted',
  upgrading = 'upgrading',
  installed = 'installed',
}

const UpdatePluginModal: FC<Props> = ({
  payload,
  pluginId,
  onSave,
  onCancel,
  isShowDowngradeWarningModal,
}) => {
  const {
    originalPackageInfo,
    targetPackageInfo,
  } = payload
  const { t } = useTranslation()
  const { getIconUrl } = useGetIcon()
  const [icon, setIcon] = useState<string>(originalPackageInfo.payload.icon)
  useEffect(() => {
    (async () => {
      const icon = await getIconUrl(originalPackageInfo.payload.icon)
      setIcon(icon)
    })()
  }, [originalPackageInfo, getIconUrl])
  const {
    check,
    stop,
  } = checkTaskStatus()
  const handleCancel = () => {
    stop()
    onCancel()
  }

  const [uploadStep, setUploadStep] = useState<UploadStep>(UploadStep.notStarted)
  const { handleRefetch } = usePluginTaskList(payload.category)

  const configBtnText = useMemo(() => {
    return ({
      [UploadStep.notStarted]: t(`${i18nPrefix}.upgrade`, { ns: 'plugin' }),
      [UploadStep.upgrading]: t(`${i18nPrefix}.upgrading`, { ns: 'plugin' }),
      [UploadStep.installed]: t(`${i18nPrefix}.close`, { ns: 'plugin' }),
    })[uploadStep]
  }, [t, uploadStep])

  const handleConfirm = useCallback(async () => {
    if (uploadStep === UploadStep.notStarted) {
      setUploadStep(UploadStep.upgrading)
      try {
        const {
          all_installed: isInstalled,
          task_id: taskId,
        } = await updateFromMarketPlace({
          original_plugin_unique_identifier: originalPackageInfo.id,
          new_plugin_unique_identifier: targetPackageInfo.id,
        })

        if (isInstalled) {
          onSave()
          return
        }
        handleRefetch()
        const { status, error } = await check({
          taskId,
          pluginUniqueIdentifier: targetPackageInfo.id,
        })
        if (status === TaskStatus.failed) {
          Toast.notify({ type: 'error', message: error! })
          return
        }
        onSave()
      }
      // eslint-disable-next-line unused-imports/no-unused-vars
      catch (e) {
        setUploadStep(UploadStep.notStarted)
      }
      return
    }
    if (uploadStep === UploadStep.installed)
      onSave()
  }, [onSave, uploadStep, check, originalPackageInfo.id, handleRefetch, targetPackageInfo.id])

  const { mutateAsync } = useRemoveAutoUpgrade()
  const invalidateReferenceSettings = useInvalidateReferenceSettings()
  const handleExcludeAndDownload = async () => {
    if (pluginId) {
      await mutateAsync({
        plugin_id: pluginId,
      })
    }
    invalidateReferenceSettings()
    handleConfirm()
  }
  const doShowDowngradeWarningModal = isShowDowngradeWarningModal && uploadStep === UploadStep.notStarted

  return (
    <Modal
      isShow={true}
      onClose={onCancel}
      className={cn('min-w-[560px]', doShowDowngradeWarningModal && 'min-w-[640px]')}
      closable
      title={!doShowDowngradeWarningModal && t(`${i18nPrefix}.${uploadStep === UploadStep.installed ? 'successfulTitle' : 'title'}`, { ns: 'plugin' })}
    >
      {doShowDowngradeWarningModal && (
        <DowngradeWarningModal
          onCancel={onCancel}
          onJustDowngrade={handleConfirm}
          onExcludeAndDowngrade={handleExcludeAndDownload}
        />
      )}
      {!doShowDowngradeWarningModal && (
        <>
          <div className="system-md-regular mb-2 mt-3 text-text-secondary">
            {t(`${i18nPrefix}.description`, { ns: 'plugin' })}
          </div>
          <div className="flex flex-wrap content-start items-start gap-1 self-stretch rounded-2xl bg-background-section-burn p-2">
            <Card
              installed={uploadStep === UploadStep.installed}
              payload={pluginManifestToCardPluginProps({
                ...originalPackageInfo.payload,
                icon: icon!,
              })}
              className="w-full"
              titleLeft={(
                <>
                  <Badge className="mx-1" size="s" state={BadgeState.Warning}>
                    {`${originalPackageInfo.payload.version} -> ${targetPackageInfo.version}`}
                  </Badge>
                </>
              )}
            />
          </div>
          <div className="flex items-center justify-end gap-2 self-stretch pt-5">
            {uploadStep === UploadStep.notStarted && (
              <Button
                onClick={handleCancel}
              >
                {t('operation.cancel', { ns: 'common' })}
              </Button>
            )}
            <Button
              variant="primary"
              loading={uploadStep === UploadStep.upgrading}
              onClick={handleConfirm}
              disabled={uploadStep === UploadStep.upgrading}
            >
              {configBtnText}
            </Button>
          </div>
        </>
      )}

    </Modal>
  )
}
export default React.memo(UpdatePluginModal)
