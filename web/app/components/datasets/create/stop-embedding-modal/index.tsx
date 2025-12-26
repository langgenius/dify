'use client'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { cn } from '@/utils/classnames'
import s from './index.module.css'

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
      <div className={s.title}>{t('stepThree.modelTitle', { ns: 'datasetCreation' })}</div>
      <div className={s.content}>{t('stepThree.modelContent', { ns: 'datasetCreation' })}</div>
      <div className="flex flex-row-reverse">
        <Button className="ml-2 w-24" variant="primary" onClick={submit}>{t('stepThree.modelButtonConfirm', { ns: 'datasetCreation' })}</Button>
        <Button className="w-24" onClick={onHide}>{t('stepThree.modelButtonCancel', { ns: 'datasetCreation' })}</Button>
      </div>
    </Modal>
  )
}

export default StopEmbeddingModal
