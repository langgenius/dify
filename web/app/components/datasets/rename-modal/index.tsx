'use client'
import type { AppIconSelection } from '../../base/app-icon-picker'
import type { DataSet } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { updateDatasetSetting } from '@/service/datasets'
import AppIcon from '../../base/app-icon'
import AppIconPicker from '../../base/app-icon-picker'

type RenameDatasetModalProps = {
  show: boolean
  dataset: DataSet
  onSuccess?: () => void
  onClose: () => void
}
const RenameDatasetModal = ({ show, dataset, onSuccess, onClose }: RenameDatasetModalProps) => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState<string>(dataset.name)
  const [description, setDescription] = useState<string>(dataset.description)
  const externalKnowledgeId = dataset.external_knowledge_info.external_knowledge_id
  const externalKnowledgeApiId = dataset.external_knowledge_info.external_knowledge_api_id
  const [appIcon, setAppIcon] = useState<AppIconSelection>(
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
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const handleOpenAppIconPicker = useCallback(() => {
    setShowAppIconPicker(true)
  }, [])
  const handleSelectAppIcon = useCallback((icon: AppIconSelection) => {
    setAppIcon(icon)
  }, [])
  const onConfirm = useCallback(async () => {
    if (!name.trim()) {
      toast.error(t(($) => $['form.nameError'], { ns: 'datasetSettings' }))
      return
    }
    try {
      setLoading(true)
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
      await updateDatasetSetting({
        datasetId: dataset.id,
        body,
      })
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      if (onSuccess) onSuccess()
      onClose()
    } catch {
      toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
    } finally {
      setLoading(false)
    }
  }, [
    appIcon,
    description,
    dataset.id,
    externalKnowledgeApiId,
    externalKnowledgeId,
    name,
    onClose,
    onSuccess,
    t,
  ])
  return (
    <Dialog
      open={show}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-full max-w-130 overflow-hidden! rounded-xl border-none px-8 py-6 text-left align-middle">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onConfirm()
          }}
        >
          <div className="flex items-center justify-between pb-2">
            <DialogTitle className="text-xl leading-7.5 font-medium text-text-primary">
              {t(($) => $.title, { ns: 'datasetSettings' })}
            </DialogTitle>
            <IconButton
              size="lg"
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              onClick={onClose}
            >
              <span aria-hidden="true" className="i-ri-close-line size-4" />
            </IconButton>
          </div>
          <Field name="name" className="gap-0 py-4">
            <FieldLabel className="w-full shrink-0 py-2 text-sm leading-5 font-medium text-text-primary">
              {t(($) => $['form.name'], { ns: 'datasetSettings' })}
            </FieldLabel>
            <div className="flex items-center gap-x-2">
              <button
                type="button"
                aria-label={`${t(($) => $['operation.edit'], { ns: 'common' })} ${t(($) => $['form.nameAndIcon'], { ns: 'datasetSettings' })}`}
                className="shrink-0 cursor-pointer rounded-[10px] border-0 bg-transparent p-0 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                onClick={handleOpenAppIconPicker}
              >
                <AppIcon
                  size="medium"
                  iconType={appIcon.type}
                  icon={appIcon.type === 'image' ? appIcon.fileId : appIcon.icon}
                  background={appIcon.type === 'image' ? undefined : appIcon.background}
                  imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
                  showEditIcon
                />
              </button>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 grow"
                placeholder={t(($) => $['form.namePlaceholder'], { ns: 'datasetSettings' }) || ''}
              />
            </div>
          </Field>
          <Field name="description" className="gap-0 py-4">
            <FieldLabel className="w-full shrink-0 py-2 text-sm leading-5 font-medium text-text-primary">
              {t(($) => $['form.desc'], { ns: 'datasetSettings' })}
            </FieldLabel>
            <Textarea
              value={description}
              onValueChange={(value) => setDescription(value)}
              className="resize-none"
              placeholder={t(($) => $['form.descPlaceholder'], { ns: 'datasetSettings' }) || ''}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-6">
            <Button type="button" onClick={onClose}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
            <Button type="submit" loading={loading} variant="primary">
              {t(($) => $['operation.save'], { ns: 'common' })}
            </Button>
          </div>
        </form>
        {showAppIconPicker && (
          <AppIconPicker
            open={showAppIconPicker}
            initialEmoji={
              appIcon.type === 'emoji'
                ? { icon: appIcon.icon, background: appIcon.background }
                : undefined
            }
            onOpenChange={setShowAppIconPicker}
            onSelect={handleSelectAppIcon}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
export default RenameDatasetModal
