import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../base/button'
import PipelineScreenShot from './screenshot'
import Confirm from '../base/confirm'

const Conversion = () => {
  const { t } = useTranslation()
  const [showConfirmModal, setShowConfirmModal] = useState(false)

  const handleConvert = useCallback(() => {
    setShowConfirmModal(false)
    // todo: Add conversion logic here
  }, [])

  const handleShowConfirmModal = useCallback(() => {
    setShowConfirmModal(true)
  }, [])

  const handleCancelConversion = useCallback(() => {
    setShowConfirmModal(false)
  }, [])

  return (
    <div className='flex h-full w-full items-center justify-center bg-background-body p-6 pb-16'>
      <div className='flex rounded-2xl border-[0.5px] border-components-card-border bg-components-card-bg shadow-sm shadow-shadow-shadow-4'>
        <div className='flex max-w-[480px] flex-col justify-between p-10'>
          <div className='flex flex-col gap-y-2.5'>
            <div className='title-4xl-semi-bold text-text-primary'>
              {t('datasetPipeline.conversion.title')}
            </div>
            <div className='body-md-medium'>
              <span className='text-text-secondary'>{t('datasetPipeline.conversion.descriptionChunk1')}</span>
              <span className='text-text-tertiary'>{t('datasetPipeline.conversion.descriptionChunk2')}</span>
            </div>
          </div>
          <div className='flex items-center gap-x-4'>
            <Button
              variant='primary'
              className='w-32'
              onClick={handleShowConfirmModal}
            >
              {t('datasetPipeline.operations.convert')}
            </Button>
            <span className='system-xs-regular text-text-warning'>
              {t('datasetPipeline.conversion.warning')}
            </span>
          </div>
        </div>
        <div className='pb-8 pl-[25px] pr-0 pt-6'>
          <div className='rounded-l-xl border border-effects-highlight bg-background-default p-1 shadow-md shadow-shadow-shadow-5 backdrop-blur-[5px]'>
            <div className='overflow-hidden rounded-l-lg'>
              <PipelineScreenShot />
            </div>
          </div>
        </div>
      </div>
      {showConfirmModal && (
        <Confirm
          title={t('datasetPipeline.conversion.confirm.title')}
          content={t('datasetPipeline.conversion.confirm.content')}
          isShow={showConfirmModal}
          onConfirm={handleConvert}
          onCancel={handleCancelConversion}
        />
      )}
    </div>
  )
}

export default React.memo(Conversion)
