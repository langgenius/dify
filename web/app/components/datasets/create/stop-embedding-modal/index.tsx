'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import s from './index.module.css'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'

type IProps = {
  show: boolean
  onConfirm: () => void
  onHide: () => void
}

const StopEmbeddingModal = ({
  show = false,
  onConfirm,
  onHide,
}: IProps) => {
  const { t } = useTranslation()

  const submit = () => {
    onConfirm()
    onHide()
  }

  return (
    <Modal
      isShow={show}
      onClose={onHide}
      className={cn(s.modal, '!max-w-[480px]', 'px-8')}
    >
      <div className={s.icon} />
      <span className={s.close} onClick={onHide} />
      <div className={s.title}>{t('datasetCreation.stepThree.modelTitle')}</div>
      <div className={s.content}>{t('datasetCreation.stepThree.modelContent')}</div>
      <div className='flex flex-row-reverse'>
        <Button className='w-24 ml-2' variant='primary' onClick={submit}>{t('datasetCreation.stepThree.modelButtonConfirm')}</Button>
        <Button className='w-24' onClick={onHide}>{t('datasetCreation.stepThree.modelButtonCancel')}</Button>
      </div>
    </Modal>
  )
}

export default StopEmbeddingModal
