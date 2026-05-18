import type {
  ApiBasedExtensionPayload,
  ApiBasedExtensionResponse,
} from '@dify/contracts/api/console/api-based-extension/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { addApiBasedExtension, updateApiBasedExtension } from '@/service/common'

type ApiBasedExtensionField = 'name' | 'api_endpoint' | 'api_key'

type ApiBasedExtensionModalProps = {
  open: boolean
  extension: Partial<ApiBasedExtensionResponse>
  onOpenChange: (open: boolean) => void
  onSave?: (newData: ApiBasedExtensionResponse) => void
}
const ApiBasedExtensionModal = ({ open, extension, onOpenChange, onSave }: ApiBasedExtensionModalProps) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const [localData, setLocalData] = useState(extension)
  const [loading, setLoading] = useState(false)
  const handleDataChange = (field: ApiBasedExtensionField, value: string) => {
    setLocalData({ ...localData, [field]: value })
  }
  const handleSave = async () => {
    setLoading(true)
    if (localData.api_key && localData.api_key.length < 5) {
      toast.error(t('apiBasedExtension.modal.apiKey.lengthError', { ns: 'common' }))
      setLoading(false)
      return
    }
    try {
      const payload: ApiBasedExtensionPayload = {
        name: localData.name || '',
        api_endpoint: localData.api_endpoint || '',
        api_key: localData.api_key || '',
      }
      let res = {} as ApiBasedExtensionResponse
      if (!extension.id) {
        res = await addApiBasedExtension({
          url: '/api-based-extension',
          body: payload,
        })
      }
      else {
        res = await updateApiBasedExtension({
          url: `/api-based-extension/${extension.id}`,
          body: {
            ...payload,
            api_key: extension.api_key === localData.api_key ? '[__HIDDEN__]' : payload.api_key,
          },
        })
        toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      }
      if (onSave)
        onSave(res)
    }
    finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent
        backdropProps={{ forceRender: true }}
        className="w-160 border-none p-8 pb-6 text-left"
      >
        <DialogCloseButton />

        <DialogTitle className="mb-2 pr-8 text-xl font-semibold text-text-primary">
          {extension.name
            ? t('apiBasedExtension.modal.editTitle', { ns: 'common' })
            : t('apiBasedExtension.modal.title', { ns: 'common' })}
        </DialogTitle>
        <div className="py-2">
          <div className="text-sm leading-9 font-medium text-text-primary">
            {t('apiBasedExtension.modal.name.title', { ns: 'common' })}
          </div>
          <input value={localData.name || ''} onChange={e => handleDataChange('name', e.target.value)} className="block h-9 w-full appearance-none rounded-lg bg-components-input-bg-normal px-3 text-sm text-text-primary outline-hidden" placeholder={t('apiBasedExtension.modal.name.placeholder', { ns: 'common' }) || ''} />
        </div>
        <div className="py-2">
          <div className="flex h-9 items-center justify-between text-sm font-medium text-text-primary">
            {t('apiBasedExtension.modal.apiEndpoint.title', { ns: 'common' })}
            <a href={docLink('/use-dify/workspace/api-extension/api-extension')} target="_blank" rel="noopener noreferrer" className="flex items-center text-xs font-normal text-text-accent">
              <span className="mr-1 i-custom-vender-line-education-book-open-01 h-3 w-3" aria-hidden="true" />
              {t('apiBasedExtension.link', { ns: 'common' })}
            </a>
          </div>
          <input value={localData.api_endpoint || ''} onChange={e => handleDataChange('api_endpoint', e.target.value)} className="block h-9 w-full appearance-none rounded-lg bg-components-input-bg-normal px-3 text-sm text-text-primary outline-hidden" placeholder={t('apiBasedExtension.modal.apiEndpoint.placeholder', { ns: 'common' }) || ''} />
        </div>
        <div className="py-2">
          <div className="text-sm leading-9 font-medium text-text-primary">
            {t('apiBasedExtension.modal.apiKey.title', { ns: 'common' })}
          </div>
          <input value={localData.api_key || ''} onChange={e => handleDataChange('api_key', e.target.value)} className="block h-9 w-full appearance-none rounded-lg bg-components-input-bg-normal px-3 text-sm text-text-primary outline-hidden" placeholder={t('apiBasedExtension.modal.apiKey.placeholder', { ns: 'common' }) || ''} />
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button variant="primary" disabled={!localData.name || !localData.api_endpoint || !localData.api_key || loading} onClick={handleSave}>
            {t('operation.save', { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
export default ApiBasedExtensionModal
