import type {
  ApiBasedExtensionPayload,
  ApiBasedExtensionResponse,
} from '@dify/contracts/api/console/api-based-extension/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { FieldControl, FieldDescription, FieldError, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { addApiBasedExtension, updateApiBasedExtension } from '@/service/common'

type ApiBasedExtensionModalProps = {
  open: boolean
  extension: Partial<ApiBasedExtensionResponse>
  onOpenChange: (open: boolean) => void
  onSave?: (newData: ApiBasedExtensionResponse) => void
  disablePointerDismissal?: boolean
}

const ApiBasedExtensionModal = ({
  open,
  extension,
  onOpenChange,
  onSave,
  disablePointerDismissal = true,
}: ApiBasedExtensionModalProps) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const [loading, setLoading] = useState(false)
  const nameLabel = t('apiBasedExtension.modal.name.title', { ns: 'common' })
  const apiEndpointLabel = t('apiBasedExtension.modal.apiEndpoint.title', { ns: 'common' })
  const apiKeyLabel = t('apiBasedExtension.modal.apiKey.title', { ns: 'common' })

  const handleSubmit = async (formValues: ApiBasedExtensionPayload) => {
    setLoading(true)

    try {
      const payload: ApiBasedExtensionPayload = {
        name: formValues.name,
        api_endpoint: formValues.api_endpoint,
        api_key: formValues.api_key,
      }

      const res = extension.id
        ? await updateApiBasedExtension({
            url: `/api-based-extension/${extension.id}`,
            body: {
              ...payload,
              api_key: extension.api_key === payload.api_key ? '[__HIDDEN__]' : payload.api_key,
            },
          })
        : await addApiBasedExtension({
            url: '/api-based-extension',
            body: payload,
          })

      if (extension.id)
        toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))

      if (onSave)
        onSave(res)
    }
    finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal={disablePointerDismissal}>
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
        <Form<ApiBasedExtensionPayload> className="grid gap-4 pt-2" onFormSubmit={handleSubmit}>
          <FieldRoot name="name">
            <FieldLabel>{nameLabel}</FieldLabel>
            <FieldControl
              required
              defaultValue={extension.name || ''}
              placeholder={t('apiBasedExtension.modal.name.placeholder', { ns: 'common' }) || ''}
            />
            <FieldError match="valueMissing">{t('errorMsg.fieldRequired', { ns: 'common', field: nameLabel })}</FieldError>
          </FieldRoot>

          <FieldRoot name="api_endpoint">
            <FieldLabel>{apiEndpointLabel}</FieldLabel>
            <FieldControl
              required
              defaultValue={extension.api_endpoint || ''}
              placeholder={t('apiBasedExtension.modal.apiEndpoint.placeholder', { ns: 'common' }) || ''}
            />
            <FieldDescription>
              <a
                href={docLink('/use-dify/workspace/api-extension/api-extension')}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
              >
                <span className="mr-1 i-custom-vender-line-education-book-open-01 h-3 w-3" aria-hidden="true" />
                {t('apiBasedExtension.link', { ns: 'common' })}
              </a>
            </FieldDescription>
            <FieldError match="valueMissing">{t('errorMsg.fieldRequired', { ns: 'common', field: apiEndpointLabel })}</FieldError>
          </FieldRoot>

          <FieldRoot
            name="api_key"
            validate={(value) => {
              if (typeof value === 'string' && value.length > 0 && value.length < 5)
                return t('apiBasedExtension.modal.apiKey.lengthError', { ns: 'common' })

              return null
            }}
          >
            <FieldLabel>{apiKeyLabel}</FieldLabel>
            <FieldControl
              required
              defaultValue={extension.api_key || ''}
              placeholder={t('apiBasedExtension.modal.apiKey.placeholder', { ns: 'common' }) || ''}
            />
            <FieldError match="valueMissing">{t('errorMsg.fieldRequired', { ns: 'common', field: apiKeyLabel })}</FieldError>
            <FieldError match="customError" />
          </FieldRoot>

          <div className="mt-2 flex items-center justify-end gap-2">
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {t('operation.save', { ns: 'common' })}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
export default ApiBasedExtensionModal
