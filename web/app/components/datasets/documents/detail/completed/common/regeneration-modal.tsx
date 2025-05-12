import React, { type FC, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiLoader2Line } from '@remixicon/react'
import { useCountDown } from 'ahooks'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { noop } from 'lodash-es'

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
      <div className='pb-4'>
        <span className='title-2xl-semi-bold text-text-primary'>{t('datasetDocuments.segment.regenerationConfirmTitle')}</span>
        <p className='system-md-regular text-text-secondary'>{t('datasetDocuments.segment.regenerationConfirmMessage')}</p>
      </div>
      <div className='flex justify-end gap-x-2 pt-6'>
        <Button onClick={onCancel}>
          {t('common.operation.cancel')}
        </Button>
        <Button variant='warning' destructive onClick={onConfirm}>
          {t('common.operation.regenerate')}
        </Button>
      </div>
    </>
  )
})

DefaultContent.displayName = 'DefaultContent'

const RegeneratingContent: FC = React.memo(() => {
  const { t } = useTranslation()

  return (
    <>
      <div className='pb-4'>
        <span className='title-2xl-semi-bold text-text-primary'>{t('datasetDocuments.segment.regeneratingTitle')}</span>
        <p className='system-md-regular text-text-secondary'>{t('datasetDocuments.segment.regeneratingMessage')}</p>
      </div>
      <div className='flex justify-end pt-6'>
        <Button variant='warning' destructive disabled className='inline-flex items-center gap-x-0.5'>
          <RiLoader2Line className='h-4 w-4 animate-spin text-components-button-destructive-primary-text-disabled' />
          <span>{t('common.operation.regenerate')}</span>
        </Button>
      </div>
    </>
  )
})

RegeneratingContent.displayName = 'RegeneratingContent'

type IRegenerationCompletedContentProps = {
  onClose: () => void
}

const RegenerationCompletedContent: FC<IRegenerationCompletedContentProps> = React.memo(({
  onClose,
}) => {
  const { t } = useTranslation()
  const targetTime = useRef(Date.now() + 5000)
  const [countdown] = useCountDown({
    targetDate: targetTime.current,
    onEnd: () => {
      onClose()
    },
  })

  return (
    <>
      <div className='pb-4'>
        <span className='title-2xl-semi-bold text-text-primary'>{t('datasetDocuments.segment.regenerationSuccessTitle')}</span>
        <p className='system-md-regular text-text-secondary'>{t('datasetDocuments.segment.regenerationSuccessMessage')}</p>
      </div>
      <div className='flex justify-end pt-6'>
        <Button variant='primary' onClick={onClose}>
          {`${t('common.operation.close')}${countdown === 0 ? '' : `(${Math.round(countdown / 1000)})`}`}
        </Button>
      </div>
    </>
  )
})

RegenerationCompletedContent.displayName = 'RegenerationCompletedContent'

type IRegenerationModalProps = {
  isShow: boolean
  onConfirm: () => void
  onCancel: () => void
  onClose: () => void
}

const RegenerationModal: FC<IRegenerationModalProps> = ({
  isShow,
  onConfirm,
  onCancel,
  onClose,
}) => {
  const [loading, setLoading] = useState(false)
  const [updateSucceeded, setUpdateSucceeded] = useState(false)
  const { eventEmitter } = useEventEmitterContextContext()

  eventEmitter?.useSubscription((v) => {
    if (v === 'update-segment') {
      setLoading(true)
      setUpdateSucceeded(false)
    }
    if (v === 'update-segment-success')
      setUpdateSucceeded(true)
    if (v === 'update-segment-done')
      setLoading(false)
  })

  return (
    <Modal isShow={isShow} onClose={noop} className='!max-w-[480px] !rounded-2xl'>
      {!loading && !updateSucceeded && <DefaultContent onCancel={onCancel} onConfirm={onConfirm} />}
      {loading && !updateSucceeded && <RegeneratingContent />}
      {!loading && updateSucceeded && <RegenerationCompletedContent onClose={onClose} />}
    </Modal>
  )
}

export default RegenerationModal
