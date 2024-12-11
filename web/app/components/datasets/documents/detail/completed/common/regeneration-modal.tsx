import React, { type FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiLoader2Line } from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { useEventEmitterContextContext } from '@/context/event-emitter'

type IDefaultContentProps = {
  onCancel: () => void
  onConfirm: () => void
}

const DefaultContent: FC<IDefaultContentProps> = React.memo(({
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation()

  return (
    <>
      <div className='p-6 pb-4'>
        <span className='text-text-primary title-2xl-semi-bold'>{t('datasetDocuments.segment.regenerationConfirm')}</span>
        <p className='text-text-secondary system-md-regular'>{t('datasetDocuments.segment.regenerationWarning')}</p>
      </div>
      <div className='flex justify-end gap-x-2 p-6'>
        <Button onClick={onCancel}>
          {t('common.operation.cancel')}
        </Button>
        <Button destructive onClick={onConfirm}>
          {t('common.operation.regenerate')}
        </Button>
      </div>
    </>
  )
})

const RegeneratingContent: FC = React.memo(() => {
  const { t } = useTranslation()

  return (
    <>
      <div className='p-6 pb-4'>
        <span className='text-text-primary title-2xl-semi-bold'>{t('datasetDocuments.segment.regeneratingTitle')}</span>
        <p className='text-text-secondary system-md-regular'>{t('datasetDocuments.segment.regeneratingMessage')}</p>
      </div>
      <div className='flex justify-end p-6'>
        <Button destructive disabled className='inline-flex items-center gap-x-0.5'>
          <RiLoader2Line className='w-4 h-4 text-components-button-destructive-primary-text-disabled' />
          <span>{t('common.operation.regenerate')}</span>
        </Button>
      </div>
    </>
  )
})

type IRegenerationCompletedContentProps = {
  onClose: () => void
}

const RegenerationCompletedContent: FC<IRegenerationCompletedContentProps> = React.memo(({
  onClose,
}) => {
  const { t } = useTranslation()
  const [countDown, setCountDown] = useState(5)
  const timerRef = useRef<any>(null)

  useEffect(() => {
    timerRef.current = setInterval(() => {
      if (countDown > 0)
        setCountDown(countDown - 1)
      else
        clearInterval(timerRef.current)
    }, 1000)
    return () => {
      clearInterval(timerRef.current)
    }
  }, [])

  return (
    <>
      <div className='p-6 pb-4'>
        <span className='text-text-primary title-2xl-semi-bold'>{t('datasetDocuments.segment.regenerationSuccessTitle')}</span>
        <p className='text-text-secondary system-md-regular'>{t('datasetDocuments.segment.regenerationSuccessMessage')}</p>
      </div>
      <div className='flex justify-end p-6'>
        <Button variant='primary' onClick={onClose}>
          {`${t('common.operation.close')}(${countDown})`}
        </Button>
      </div>
    </>
  )
})

type IRegenerationModalProps = {
  isShow: boolean
  onConfirm: () => void
  onCancel: () => void
}

const RegenerationModal: FC<IRegenerationModalProps> = ({
  isShow,
  onConfirm,
  onCancel,
}) => {
  const [loading, setLoading] = useState(false)
  const [updateSuccess, setUpdateSuccess] = useState(false)
  const { eventEmitter } = useEventEmitterContextContext()

  eventEmitter?.useSubscription((v) => {
    if (v === 'update-segment') {
      setLoading(true)
      setUpdateSuccess(false)
    }
    if (v === 'update-segment-success')
      setUpdateSuccess(true)
    if (v === 'update-segment-done')
      setLoading(false)
  })

  return (
    <Modal isShow={isShow} onClose={() => {}} className='!max-w-[480px] !rounded-2xl'>
      {(!loading && !updateSuccess) && <DefaultContent onCancel={onCancel} onConfirm={onConfirm} />}
      {(loading && !updateSuccess) && <RegeneratingContent />}
      {!loading && updateSuccess && <RegenerationCompletedContent onClose={onCancel} />}
    </Modal>
  )
}

export default RegenerationModal
