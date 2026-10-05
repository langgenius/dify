'use client'
import type { IconPickerValue } from '@/app/components/base/icon-picker'
import type { DataSet } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconPicker,
  IconPickerContent,
  IconPickerIcon,
  IconPickerTrigger,
} from '@/app/components/base/icon-picker'
import { toast } from '@/app/notifications'
import { updateDatasetSetting } from '@/service/datasets'

type RenameDatasetModalProps = {
  open: boolean
  dataset: DataSet
  onSuccess?: () => void
  onOpenChange: (open: boolean) => void
}
type RenameDatasetFormProps = {
  dataset: DataSet
  loading: boolean
  onSave: (request: Parameters<typeof updateDatasetSetting>[0]) => Promise<void>
}

function RenameDatasetForm({ dataset, loading, onSave }: RenameDatasetFormProps) {
  const { t } = useTranslation(['common', 'datasetSettings'])
  const [name, setName] = useState<string>(dataset.name)
  const [description, setDescription] = useState<string>(dataset.description)
  const externalKnowledgeId = dataset.external_knowledge_info.external_knowledge_id
  const externalKnowledgeApiId = dataset.external_knowledge_info.external_knowledge_api_id
  const [appIcon, setAppIcon] = useState<IconPickerValue>(
    dataset.icon_info?.icon_type === 'image'
      ? {
          type: 'image' as const,
          url: dataset.icon_info?.icon_url || '',
          fileId: dataset.icon_info?.icon || '',
        }
      : {
          type: 'emoji' as const,
          icon: dataset.icon_info?.icon || '',
          background: dataset.icon_info?.icon_background || '',
        },
  )
  const handleSelectAppIcon = useCallback((icon: IconPickerValue) => {
    setAppIcon(icon)
  }, [])
  const onConfirm = useCallback(async () => {
    if (loading) return
    if (!name.trim()) {
      toast.error(t(($) => $['form.nameError'], { ns: 'datasetSettings' }))
      return
    }
    const body: Partial<DataSet> & {
      external_knowledge_id?: string
      external_knowledge_api_id?: string
    } = {
      name,
      description,
      icon_info: {
        icon: appIcon.type === 'image' ? appIcon.fileId : appIcon.icon,
        icon_type: appIcon.type,
        icon_background: appIcon.type === 'image' ? undefined : appIcon.background,
        icon_url: appIcon.type === 'image' ? appIcon.url : undefined,
      },
    }
    if (externalKnowledgeId && externalKnowledgeApiId) {
      body.external_knowledge_id = externalKnowledgeId
      body.external_knowledge_api_id = externalKnowledgeApiId
    }
    await onSave({
      datasetId: dataset.id,
      body,
    })
  }, [
    appIcon,
    description,
    dataset.id,
    externalKnowledgeApiId,
    externalKnowledgeId,
    name,
    onSave,
    loading,
    t,
  ])
  return (
    <form
      onSubmit={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        event.stopPropagation()
        void onConfirm()
      }}
    >
      <div className="flex items-center justify-between pb-2">
        <DialogTitle className="text-xl leading-7.5 font-medium text-text-primary">
          {t(($) => $.title, { ns: 'datasetSettings' })}
        </DialogTitle>
        <DialogClose
          disabled={loading}
          render={
            <IconButton size="lg" aria-label={t(($) => $['operation.close'], { ns: 'common' })}>
              <span aria-hidden="true" className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 py-4">
        <IconPicker value={appIcon} onValueChange={handleSelectAppIcon}>
          <IconPickerTrigger
            disabled={loading}
            className="group/edit-icon col-start-1 row-start-2 shrink-0 cursor-pointer rounded-[10px] border-0 bg-transparent p-0"
            aria-label={`${t(($) => $['operation.edit'], { ns: 'common' })} ${t(($) => $['form.nameAndIcon'], { ns: 'datasetSettings' })}`}
          >
            <IconPickerIcon size="medium" showEditIcon />
          </IconPickerTrigger>
          <IconPickerContent />
        </IconPicker>
        <Field name="name" className="contents">
          <FieldLabel className="col-span-2 row-start-1 w-full shrink-0 py-2 text-sm leading-5 font-medium text-text-primary">
            {t(($) => $['form.name'], { ns: 'datasetSettings' })}
          </FieldLabel>
          <Input
            readOnly={loading}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="col-start-2 row-start-2 h-9 grow"
            placeholder={t(($) => $['form.namePlaceholder'], { ns: 'datasetSettings' }) || ''}
          />
        </Field>
      </div>
      <Field name="description" className="gap-0 py-4">
        <FieldLabel className="w-full shrink-0 py-2 text-sm leading-5 font-medium text-text-primary">
          {t(($) => $['form.desc'], { ns: 'datasetSettings' })}
        </FieldLabel>
        <Textarea
          readOnly={loading}
          value={description}
          onValueChange={(value) => setDescription(value)}
          className="resize-none"
          placeholder={t(($) => $['form.descPlaceholder'], { ns: 'datasetSettings' }) || ''}
        />
      </Field>
      <div className="flex justify-end gap-2 pt-6">
        <DialogClose disabled={loading} render={<Button />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" loading={loading} variant="primary">
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </div>
    </form>
  )
}
export function RenameDatasetModal({
  open,
  dataset,
  onSuccess,
  onOpenChange,
}: RenameDatasetModalProps) {
  const { t } = useTranslation(['common'])
  const [loading, setLoading] = useState(false)
  const handleSave = async (request: Parameters<typeof updateDatasetSetting>[0]) => {
    if (loading) return
    try {
      setLoading(true)
      await updateDatasetSetting(request)
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      onSuccess?.()
      onOpenChange(false)
    } catch {
      toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (loading) {
          details.cancel()
          return
        }
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="w-full max-w-130 overflow-hidden! rounded-xl border-none px-8 py-6 text-left align-middle">
        <RenameDatasetForm dataset={dataset} loading={loading} onSave={handleSave} />
      </DialogContent>
    </Dialog>
  )
}
