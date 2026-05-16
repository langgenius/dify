import type { FC } from 'react'
import type { CreateExternalAPIReq, FormSchema } from '../declarations'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { RiBook2Line, RiCloseLine, RiInformation2Line, RiLock2Fill } from '@remixicon/react'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { createExternalAPI } from '@/service/datasets'
import Form from './Form'

type AddExternalAPIModalProps = {
  data?: CreateExternalAPIReq
  onSave: (formValue: CreateExternalAPIReq) => void
  onCancel: () => void
  onEdit?: (formValue: CreateExternalAPIReq) => Promise<void>
  datasetBindings?: {
    id: string
    name: string
  }[]
  isEditMode: boolean
}
const formSchemas: FormSchema[] = [
  {
    variable: 'name',
    type: 'text',
    label: {
      en_US: 'Name',
    },
    required: true,
  },
  {
    variable: 'endpoint',
    type: 'text',
    label: {
      en_US: 'API Endpoint',
    },
    required: true,
  },
  {
    variable: 'api_key',
    type: 'secret',
    label: {
      en_US: 'API Key',
    },
    required: true,
  },
]

const emptyExternalAPIFormData: CreateExternalAPIReq = {
  name: '',
  settings: {
    endpoint: '',
    api_key: '',
  },
}

const AddExternalAPIModal: FC<AddExternalAPIModalProps> = ({ data, onSave, onCancel, datasetBindings, isEditMode, onEdit }) => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [formData, setFormData] = useState<CreateExternalAPIReq>(() => isEditMode && data ? data : emptyExternalAPIFormData)
  const hasEmptyInputs = Object.values(formData).some(value => typeof value === 'string' ? value.trim() === '' : Object.values(value).some(v => v.trim() === ''))
  const handleDataChange = (val: CreateExternalAPIReq) => {
    setFormData(val)
  }
  const handleSave = async () => {
    if (formData && formData.settings.api_key && formData.settings.api_key?.length < 5) {
      toast.error(t('apiBasedExtension.modal.apiKey.lengthError', { ns: 'common' }))
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      if (isEditMode && onEdit) {
        // Only send [__HIDDEN__] when the user has not changed the key, otherwise
        // send the actual api_key so updated tokens are persisted.
        const apiKeyToSend = formData.settings.api_key === '[__HIDDEN__]'
          ? '[__HIDDEN__]'
          : formData.settings.api_key
        await onEdit({
          ...formData,
          settings: { ...formData.settings, api_key: apiKeyToSend },
        })
        toast.success('External API updated successfully')
      }
      else {
        const res = await createExternalAPI({ body: formData })
        if (res && res.id) {
          toast.success('External API saved successfully')
          onSave(res)
        }
      }
      onCancel()
    }
    catch (error) {
      console.error('Error saving/updating external API:', error)
      toast.error('Failed to save/update External API')
    }
    finally {
      setLoading(false)
    }
  }
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open)
          onCancel()
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[480px]! max-w-none! flex-col overflow-hidden! rounded-2xl! border-[0.5px]! border-components-panel-border! bg-components-panel-bg! p-0! shadow-xl!">
        <div className="relative flex min-h-0 w-full flex-1 flex-col items-start">
          <div className="flex shrink-0 flex-col items-start gap-2 self-stretch pt-6 pr-14 pb-3 pl-6">
            <DialogTitle className="grow self-stretch title-2xl-semi-bold text-text-primary">
              {isEditMode ? t('editExternalAPIFormTitle', { ns: 'dataset' }) : t('createExternalAPI', { ns: 'dataset' })}
            </DialogTitle>
            {isEditMode && (datasetBindings?.length ?? 0) > 0 && (
              <div className="flex items-center system-xs-regular text-text-tertiary">
                {t('editExternalAPIFormWarning.front', { ns: 'dataset' })}
                <span className="flex cursor-pointer items-center text-text-accent">
                  &nbsp;
                  {datasetBindings?.length}
                  {' '}
                  {t('editExternalAPIFormWarning.end', { ns: 'dataset' })}
&nbsp;
                  <Popover>
                    <PopoverTrigger
                      openOnHover
                      aria-label={t('editExternalAPIFormWarning.end', { ns: 'dataset' })}
                      render={(
                        <button
                          type="button"
                          className="flex h-3.5 w-3.5 items-center justify-center rounded-sm outline-hidden hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
                        >
                          <RiInformation2Line className="h-3.5 w-3.5" />
                        </button>
                      )}
                    />
                    <PopoverContent
                      placement="bottom"
                      popupClassName="flex w-[320px] items-center self-stretch px-3 py-2"
                    >
                      <div className="p-1">
                        <div className="flex items-start self-stretch pt-1 pr-3 pb-0.5 pl-2">
                          <div className="system-xs-medium-uppercase text-text-tertiary">{`${datasetBindings?.length} ${t('editExternalAPITooltipTitle', { ns: 'dataset' })}`}</div>
                        </div>
                        {datasetBindings?.map(binding => (
                          <div key={binding.id} className="flex items-center gap-1 self-stretch px-2 py-1">
                            <RiBook2Line className="h-4 w-4 text-text-secondary" />
                            <div className="system-sm-medium text-text-secondary">{binding.name}</div>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </span>
              </div>
            )}
          </div>
          <ActionButton className="absolute top-5 right-5" onClick={onCancel}>
            <RiCloseLine className="h-[18px] w-[18px] shrink-0 text-text-tertiary" />
          </ActionButton>
          <Form value={formData} onChange={handleDataChange} formSchemas={formSchemas} className="min-h-0 w-full flex-1 overflow-y-auto px-6 py-3" />
          <div className="flex shrink-0 items-center justify-end gap-2 self-stretch p-6 pt-5">
            <Button type="button" variant="secondary" onClick={onCancel}>
              {t('externalAPIForm.cancel', { ns: 'dataset' })}
            </Button>
            <Button
              type="submit"
              variant="primary"
              onClick={() => {
                if (isEditMode && (datasetBindings?.length ?? 0) > 0)
                  setShowConfirm(true)
                else if (isEditMode && onEdit)
                  onEdit(formData)
                else
                  handleSave()
              }}
              disabled={hasEmptyInputs || loading}
            >
              {t('externalAPIForm.save', { ns: 'dataset' })}
            </Button>
          </div>
          <div className="flex shrink-0 items-center justify-center gap-1 self-stretch rounded-b-2xl border-t-[0.5px] border-divider-subtle
            bg-background-soft px-2 py-3 system-xs-regular text-text-tertiary"
          >
            <RiLock2Fill className="h-3 w-3 text-text-quaternary" />
            {t('externalAPIForm.encrypted.front', { ns: 'dataset' })}
            <a className="text-text-accent" target="_blank" rel="noopener noreferrer" href="https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html">
              PKCS1_OAEP
            </a>
            {t('externalAPIForm.encrypted.end', { ns: 'dataset' })}
          </div>
        </div>
        <AlertDialog
          open={showConfirm && (datasetBindings?.length ?? 0) > 0}
          onOpenChange={open => !open && setShowConfirm(false)}
        >
          <AlertDialogContent>
            <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
              <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                Warning
              </AlertDialogTitle>
              <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                {`${t('editExternalAPIConfirmWarningContent.front', { ns: 'dataset' })} ${datasetBindings?.length} ${t('editExternalAPIConfirmWarningContent.end', { ns: 'dataset' })}`}
              </AlertDialogDescription>
            </div>
            <AlertDialogActions>
              <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
              <AlertDialogConfirmButton onClick={handleSave}>
                {t('operation.confirm', { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogActions>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
export default memo(AddExternalAPIModal)
