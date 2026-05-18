'use client'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
    <AlertDialog
      open={show}
      onOpenChange={(open) => {
        if (!open)
          onHide()
      }}
    >
      <AlertDialogContent className={cn(s.modal, 'max-w-[480px]! overflow-hidden! border-none px-8 py-6 text-left align-middle shadow-xl')}>
        <div className={s.icon} />
        <button
          type="button"
          className={cn(s.close, 'border-none bg-transparent p-0 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden')}
          aria-label={t('operation.close', { ns: 'common' })}
          onClick={onHide}
        />
        <AlertDialogTitle className={s.title}>{t('stepThree.modelTitle', { ns: 'datasetCreation' })}</AlertDialogTitle>
        <AlertDialogDescription className={s.content}>{t('stepThree.modelContent', { ns: 'datasetCreation' })}</AlertDialogDescription>
        <AlertDialogActions className="flex-row-reverse gap-0 p-0">
          <AlertDialogConfirmButton className="ml-2 w-24" tone="default" onClick={submit}>{t('stepThree.modelButtonConfirm', { ns: 'datasetCreation' })}</AlertDialogConfirmButton>
          <AlertDialogCancelButton className="w-24" variant="secondary">{t('stepThree.modelButtonCancel', { ns: 'datasetCreation' })}</AlertDialogCancelButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default StopEmbeddingModal
