'use client'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { toast } from '@/app/notifications'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { createEmptyDataset } from '@/service/datasets'
import s from './index.module.css'

type IProps = {
  show: boolean
  onHide: () => void
}
const EmptyDatasetCreationModal = ({ show = false, onHide }: IProps) => {
  const [inputValue, setInputValue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { t } = useTranslation(['common', 'datasetCreation'])
  const router = useRouter()
  const queryClient = useQueryClient()
  const invalidDatasetList = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: consoleQuery.datasets.get.key() })
  }, [queryClient])
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
      <DialogContent className="w-130">
        <DialogHeader>
          <DialogTitle>{t(($) => $['stepOne.modal.title'], { ns: 'datasetCreation' })}</DialogTitle>
          <DialogDescription>
            {t(($) => $['stepOne.modal.tip'], { ns: 'datasetCreation' })}
          </DialogDescription>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <Form className="contents" onFormSubmit={() => void submit()}>
          <DialogBody>
            <Field name="datasetName">
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
          </DialogBody>
          <DialogFooter>
            <Button type="button" className="w-24" onClick={onHide}>
              {t(($) => $['stepOne.modal.cancelButton'], { ns: 'datasetCreation' })}
            </Button>
            <Button type="submit" className="w-24" variant="primary" loading={isSubmitting}>
              {t(($) => $['stepOne.modal.confirmButton'], { ns: 'datasetCreation' })}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
export default EmptyDatasetCreationModal
