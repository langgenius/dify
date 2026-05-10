'use client'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import Input from '@/app/components/base/input'
import { useRouter } from '@/next/navigation'
import { createEmptyDataset } from '@/service/datasets'
import { useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import s from './index.module.css'

type IProps = {
  show: boolean
  onHide: () => void
}
const EmptyDatasetCreationModal = ({ show = false, onHide }: IProps) => {
  const [inputValue, setInputValue] = useState('')
  const { t } = useTranslation()
  const router = useRouter()
  const invalidDatasetList = useInvalidDatasetList()
  const submit = async () => {
    if (!inputValue) {
      toast.error(t('stepOne.modal.nameNotEmpty', { ns: 'datasetCreation' }))
      return
    }
    if (inputValue.length > 40) {
      toast.error(t('stepOne.modal.nameLengthInvalid', { ns: 'datasetCreation' }))
      return
    }
    try {
      const dataset = await createEmptyDataset({ name: inputValue })
      invalidDatasetList()
      trackEvent('create_empty_datasets', {
        name: inputValue,
        dataset_id: dataset.id,
      })
      onHide()
      router.push(`/datasets/${dataset.id}/documents`)
    }
    catch {
      toast.error(t('stepOne.modal.failed', { ns: 'datasetCreation' }))
    }
  }
  return (
    <Dialog
      open={show}
      onOpenChange={(open) => {
        if (!open)
          onHide()
      }}
    >
      <DialogContent className={cn('w-full overflow-hidden! border-none text-left align-middle', cn(s.modal, '!max-w-[520px]', 'px-8'))}>

        <div className={s.modalHeader}>
          <div className={s.title}>{t('stepOne.modal.title', { ns: 'datasetCreation' })}</div>
          <span className={s.close} onClick={onHide} />
        </div>
        <div className={s.tip}>{t('stepOne.modal.tip', { ns: 'datasetCreation' })}</div>
        <div className={s.form}>
          <div className={s.label}>{t('stepOne.modal.input', { ns: 'datasetCreation' })}</div>
          <Input value={inputValue} placeholder={t('stepOne.modal.placeholder', { ns: 'datasetCreation' }) || ''} onChange={e => setInputValue(e.target.value)} />
        </div>
        <div className="flex flex-row-reverse">
          <Button className="ml-2 w-24" variant="primary" onClick={submit}>{t('stepOne.modal.confirmButton', { ns: 'datasetCreation' })}</Button>
          <Button className="w-24" onClick={onHide}>{t('stepOne.modal.cancelButton', { ns: 'datasetCreation' })}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
export default EmptyDatasetCreationModal
