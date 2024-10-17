'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo, useState } from 'react'
import { RiInformation2Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Card from '@/app/components/plugins/card'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Badge, { BadgeState } from '@/app/components/base/badge/index'
import { toolNotion } from '@/app/components/plugins/card/card-mock'

const i18nPrefix = 'plugin.upgrade'

type Props = {
  onHide: () => void
}

enum UploadStep {
  notStarted = 'notStarted',
  upgrading = 'upgrading',
  installed = 'installed',
}

const UpdatePluginModal: FC<Props> = ({
  onHide,
}) => {
  const { t } = useTranslation()
  const [uploadStep, setUploadStep] = useState<UploadStep>(UploadStep.notStarted)
  const configBtnText = useMemo(() => {
    return ({
      [UploadStep.notStarted]: t(`${i18nPrefix}.upgrade`),
      [UploadStep.upgrading]: t(`${i18nPrefix}.upgrading`),
      [UploadStep.installed]: t(`${i18nPrefix}.close`),
    })[uploadStep]
  }, [uploadStep])
  const handleConfirm = useCallback(() => {
    if (uploadStep === UploadStep.notStarted) {
      setUploadStep(UploadStep.upgrading)
      setTimeout(() => {
        setUploadStep(UploadStep.installed)
      }, 1500)
      return
    }
    if (uploadStep === UploadStep.installed)
      onHide()
  }, [uploadStep])
  return (
    <Modal
      isShow={true}
      onClose={onHide}
      className='min-w-[560px]'
      closable
      title={t(`${i18nPrefix}.${uploadStep === UploadStep.installed ? 'successfulTitle' : 'title'}`)}
    >
      <div className='mt-3 mb-2 text-text-secondary system-md-regular'>
        {t(`${i18nPrefix}.description`)}
      </div>
      <div className='flex p-2 items-start content-start gap-1 self-stretch flex-wrap rounded-2xl bg-background-section-burn'>
        <Card
          installed={uploadStep === UploadStep.installed}
          payload={toolNotion as any}
          className='w-full'
          titleLeft={
            <>
              <Badge className='mx-1' size="s" state={BadgeState.Warning}>
                {'1.2.0 -> 1.3.2'}
              </Badge>
              <div className='flex px-0.5 justify-center items-center gap-0.5'>
                <div className='text-text-warning system-xs-medium'>{t(`${i18nPrefix}.usedInApps`, { num: 3 })}</div>
                {/* show the used apps */}
                <RiInformation2Line className='w-4 h-4 text-text-tertiary' />
              </div>
            </>
          }
        />
      </div>
      <div className='flex pt-5 justify-end items-center gap-2 self-stretch'>
        {uploadStep === UploadStep.notStarted && (
          <Button
            onClick={onHide}
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
