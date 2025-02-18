'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { RiInformation2Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Card from '@/app/components/plugins/card'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Badge, { BadgeState } from '@/app/components/base/badge/index'
import { TaskStatus, type UpdateFromMarketPlacePayload } from '../types'
import { pluginManifestToCardPluginProps } from '@/app/components/plugins/install-plugin/utils'
import useGetIcon from '../install-plugin/base/use-get-icon'
import { updateFromMarketPlace } from '@/service/plugins'
import checkTaskStatus from '@/app/components/plugins/install-plugin/base/check-task-status'
import { usePluginTaskList } from '@/service/use-plugins'
import Toast from '../../base/toast'

const i18nPrefix = 'plugin.upgrade'

type Props = {
  payload: UpdateFromMarketPlacePayload
  onSave: () => void
  onCancel: () => void
}

enum UploadStep {
  notStarted = 'notStarted',
  upgrading = 'upgrading',
  installed = 'installed',
}

const UpdatePluginModal: FC<Props> = ({
  payload,
  onSave,
  onCancel,
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
      [UploadStep.notStarted]: t(`${i18nPrefix}.upgrade`),
      [UploadStep.upgrading]: t(`${i18nPrefix}.upgrading`),
      [UploadStep.installed]: t(`${i18nPrefix}.close`),
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
  const usedInAppInfo = useMemo(() => {
    return (
      <div className='flex items-center justify-center gap-0.5 px-0.5'>
        <div className='text-text-warning system-xs-medium'>{t(`${i18nPrefix}.usedInApps`, { num: 3 })}</div>
        {/* show the used apps */}
        <RiInformation2Line className='text-text-tertiary h-4 w-4' />
      </div>
    )
  }, [t])
  return (
    <Modal
      isShow={true}
      onClose={onCancel}
      className='min-w-[560px]'
      closable
      title={t(`${i18nPrefix}.${uploadStep === UploadStep.installed ? 'successfulTitle' : 'title'}`)}
    >
      <div className='text-text-secondary system-md-regular mb-2 mt-3'>
        {t(`${i18nPrefix}.description`)}
      </div>
      <div className='bg-background-section-burn flex flex-wrap content-start items-start gap-1 self-stretch rounded-2xl p-2'>
        <Card
          installed={uploadStep === UploadStep.installed}
          payload={pluginManifestToCardPluginProps({
            ...originalPackageInfo.payload,
            icon: icon!,
          })}
          className='w-full'
          titleLeft={
            <>
              <Badge className='mx-1' size="s" state={BadgeState.Warning}>
                {`${originalPackageInfo.payload.version} -> ${targetPackageInfo.version}`}
              </Badge>
              {false && usedInAppInfo}
            </>
          }
        />
      </div>
      <div className='flex items-center justify-end gap-2 self-stretch pt-5'>
        {uploadStep === UploadStep.notStarted && (
          <Button
            onClick={handleCancel}
          >
            {t('common.operation.cancel')}
          </Button>
        )}
        <Button
          variant='primary'
          loading={uploadStep === UploadStep.upgrading}
          onClick={handleConfirm}
          disabled={uploadStep === UploadStep.upgrading}
        >
          {configBtnText}
        </Button>
      </div>
    </Modal>
  )
}
export default React.memo(UpdatePluginModal)
