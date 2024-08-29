'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import s from './index.module.css'
import cn from '@/utils/classnames'
import Modal from '@/app/components/base/modal'
import Input from '@/app/components/base/input'
import Button from '@/app/components/base/button'

import { ToastContext } from '@/app/components/base/toast'
import { createEmptyDataset } from '@/service/datasets'

type IProps = {
  show: boolean
  onHide: () => void
}

const EmptyDatasetCreationModal = ({
  show = false,
  onHide,
}: IProps) => {
  const [inputValue, setInputValue] = useState('')
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const router = useRouter()

  const submit = async () => {
    if (!inputValue) {
      notify({ type: 'error', message: t('datasetCreation.stepOne.modal.nameNotEmpty') })
      return
    }
    if (inputValue.length > 40) {
      notify({ type: 'error', message: t('datasetCreation.stepOne.modal.nameLengthInvaild') })
      return
    }
    try {
      const dataset = await createEmptyDataset({ name: inputValue })
      onHide()
      router.push(`/datasets/${dataset.id}/documents`)
    }
    catch (err) {
      notify({ type: 'error', message: t('datasetCreation.stepOne.modal.failed') })
    }
  }

  return (
    <Modal
      isShow={show}
      onClose={onHide}
      className={cn(s.modal, '!max-w-[520px]', 'px-8')}
    >
      <div className={s.modalHeader}>
        <div className={s.title}>{t('datasetCreation.stepOne.modal.title')}</div>
        <span className={s.close} onClick={onHide} />
      </div>
      <div className={s.tip}>{t('datasetCreation.stepOne.modal.tip')}</div>
      <div className={s.form}>
        <div className={s.label}>{t('datasetCreation.stepOne.modal.input')}</div>
        <Input className='!h-8' value={inputValue} placeholder={t('datasetCreation.stepOne.modal.placeholder') || ''} onChange={e => setInputValue(e.target.value)} />
      </div>
      <div className='flex flex-row-reverse'>
        <Button className='w-24 ml-2' variant='primary' onClick={submit}>{t('datasetCreation.stepOne.modal.confirmButton')}</Button>
        <Button className='w-24' onClick={onHide}>{t('datasetCreation.stepOne.modal.cancelButton')}</Button>
      </div>
    </Modal>
  )
}

export default EmptyDatasetCreationModal
