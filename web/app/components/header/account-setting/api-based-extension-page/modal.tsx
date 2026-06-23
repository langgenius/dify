import type {
  ApiBasedExtensionPayload,
  ApiBasedExtensionResponse,
} from '@dify/contracts/api/console/api-based-extension/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { FieldControl, FieldDescription, FieldError, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from '#i18n'
import { useDocLink } from '@/context/i18n'
import { consoleQuery } from '@/service/client'

type ApiBasedExtensionModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
} & ({
  mode: 'create'
} | {
  mode: 'edit'
  apiBasedExtension: ApiBasedExtensionResponse
})

export function ApiBasedExtensionModal(props: ApiBasedExtensionModalProps) {
  const { open, mode, onOpenChange, onSaved } = props
  const { t } = useTranslation()
  const docLink = useDocLink()
  const createApiBasedExtensionMutation = useMutation(consoleQuery.apiBasedExtension.post.mutationOptions())
  const updateApiBasedExtensionMutation = useMutation(consoleQuery.apiBasedExtension.byId.post.mutationOptions())
  const editingApiBasedExtension = mode === 'edit' ? props.apiBasedExtension : null
  const isSaving = createApiBasedExtensionMutation.isPending || updateApiBasedExtensionMutation.isPending
  const nameLabel = t('apiBasedExtension.modal.name.title', { ns: 'common' })
  const apiEndpointLabel = t('apiBasedExtension.modal.apiEndpoint.title', { ns: 'common' })
  const apiKeyLabel = t('apiBasedExtension.modal.apiKey.title', { ns: 'common' })

  const handleSubmit = (formValues: ApiBasedExtensionPayload) => {
    const body: ApiBasedExtensionPayload = {
      name: formValues.name,
      api_endpoint: formValues.api_endpoint,
      api_key: formValues.api_key,
    }

    if (editingApiBasedExtension) {
      updateApiBasedExtensionMutation.mutate({
        params: {
          id: editingApiBasedExtension.id,
        },
        body: {
          ...body,
          api_key: editingApiBasedExtension.api_key === body.api_key ? '[__HIDDEN__]' : body.api_key,
        },
      }, {
        onSuccess: () => {
          toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
          onSaved()
        },
      })
      return
    }

    createApiBasedExtensionMutation.mutate({
      body,
    }, {
      onSuccess: onSaved,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent
        backdropProps={{ forceRender: true }}
        className="w-160 border-none p-8 pb-6 text-left"
      >
        <DialogCloseButton />

        <DialogTitle className="mb-2 pr-8 text-xl font-semibold text-text-primary">
          {mode === 'edit'
            ? t('apiBasedExtension.modal.editTitle', { ns: 'common' })
            : t('apiBasedExtension.modal.title', { ns: 'common' })}
        </DialogTitle>
        <Form<ApiBasedExtensionPayload> className="grid gap-4 pt-2" onFormSubmit={handleSubmit}>
          <FieldRoot name="name">
            <FieldLabel>{nameLabel}</FieldLabel>
            <FieldControl
              required
              defaultValue={editingApiBasedExtension?.name || ''}
              placeholder={t('apiBasedExtension.modal.name.placeholder', { ns: 'common' }) || ''}
            />
            <FieldError match="valueMissing">{t('errorMsg.fieldRequired', { ns: 'common', field: nameLabel })}</FieldError>
          </FieldRoot>

          <FieldRoot name="api_endpoint">
            <FieldLabel>{apiEndpointLabel}</FieldLabel>
            <FieldControl
              required
              defaultValue={editingApiBasedExtension?.api_endpoint || ''}
              placeholder={t('apiBasedExtension.modal.apiEndpoint.placeholder', { ns: 'common' }) || ''}
            />
            <FieldDescription>
              <a
                href={docLink('/use-dify/workspace/api-extension/api-extension')}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
              >
                <span className="mr-1 i-custom-vender-line-education-book-open-01 size-3" aria-hidden="true" />
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
              defaultValue={editingApiBasedExtension?.api_key || ''}
              placeholder={t('apiBasedExtension.modal.apiKey.placeholder', { ns: 'common' }) || ''}
            />
            <FieldError match="valueMissing">{t('errorMsg.fieldRequired', { ns: 'common', field: apiKeyLabel })}</FieldError>
            <FieldError match="customError" />
          </FieldRoot>

          <div className="mt-2 flex items-center justify-end gap-2">
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" variant="primary" disabled={isSaving}>
              {t('operation.save', { ns: 'common' })}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
