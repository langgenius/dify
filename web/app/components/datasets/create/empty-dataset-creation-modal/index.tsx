'use client'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
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
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { t } = useTranslation()
  const router = useRouter()
  const invalidDatasetList = useInvalidDatasetList()
  const submit = async () => {
    if (isSubmitting) return

    if (!inputValue) {
      toast.error(t(($) => $['stepOne.modal.nameNotEmpty'], { ns: 'datasetCreation' }))
      return
    }
    if (inputValue.length > 40) {
      toast.error(t(($) => $['stepOne.modal.nameLengthInvalid'], { ns: 'datasetCreation' }))
      return
    }
    setIsSubmitting(true)
    try {
      const dataset = await createEmptyDataset({ name: inputValue })
      invalidDatasetList()
      trackEvent('create_empty_datasets', {
        name: inputValue,
        dataset_id: dataset.id,
      })
      onHide()
      router.push(`/datasets/${dataset.id}/documents`)
    } catch {
      toast.error(t(($) => $['stepOne.modal.failed'], { ns: 'datasetCreation' }))
    } finally {
      setIsSubmitting(false)
    }
  }
  return (
    <Dialog
      open={show}
      onOpenChange={(open) => {
        if (!open) onHide()
      }}
    >
      <DialogContent className="w-full max-w-130! overflow-hidden! border-none px-8 text-left align-middle">
        <div className={s.modalHeader}>
          <DialogTitle className={s.title}>
            {t(($) => $['stepOne.modal.title'], { ns: 'datasetCreation' })}
          </DialogTitle>
          <button
            type="button"
            className={cn(
              s.close,
              'border-none bg-transparent p-0 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden',
            )}
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            onClick={onHide}
          />
        </div>
        <div className={s.tip}>{t(($) => $['stepOne.modal.tip'], { ns: 'datasetCreation' })}</div>
        <Form onFormSubmit={() => void submit()}>
          <Field name="datasetName" className={cn(s.form, 'gap-2')}>
            <FieldLabel className={s.label}>
              {t(($) => $['stepOne.modal.input'], { ns: 'datasetCreation' })}
            </FieldLabel>
            <Input
              value={inputValue}
              placeholder={
                t(($) => $['stepOne.modal.placeholder'], { ns: 'datasetCreation' }) || ''
              }
              onValueChange={setInputValue}
            />
          </Field>
          <div className="flex flex-row-reverse">
            <Button type="submit" className="ml-2 w-24" variant="primary" loading={isSubmitting}>
              {t(($) => $['stepOne.modal.confirmButton'], { ns: 'datasetCreation' })}
            </Button>
            <Button type="button" className="w-24" onClick={onHide}>
              {t(($) => $['stepOne.modal.cancelButton'], { ns: 'datasetCreation' })}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
export default EmptyDatasetCreationModal
