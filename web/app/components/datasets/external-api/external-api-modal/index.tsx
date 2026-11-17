import type { ExternalKnowledgeApiResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { CreateExternalAPIReq, FormSchema } from '../declarations'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { DialogBody, DialogClose, DialogFooter } from '@langgenius/dify-ui/dialog'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EncryptedBottom } from '@/app/components/base/encrypted-bottom'
import { toast } from '@/app/notifications'
import ExternalAPIForm from './Form'

type ExternalApiEditorProps = {
  api?: ExternalKnowledgeApiResponse
  pending: boolean
  onSubmit: (values: CreateExternalAPIReq) => void
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

function isValidHttpEndpoint(value: string) {
  try {
    const endpoint = new URL(value)
    return (
      (endpoint.protocol === 'http:' || endpoint.protocol === 'https:') && Boolean(endpoint.host)
    )
  } catch {
    return false
  }
}

const ExternalApiEditor = ({ api, pending, onSubmit }: ExternalApiEditorProps) => {
  const datasetBindings = api?.dataset_bindings
  const { t } = useTranslation(['common', 'dataset'])
  const formId = useId()
  const [showConfirm, setShowConfirm] = useState(false)
  const [endpointError, setEndpointError] = useState<string>()
  const [formData, setFormData] = useState<CreateExternalAPIReq>(() =>
    api
      ? {
          name: api.name,
          settings: {
            endpoint: api.settings?.endpoint ?? '',
            api_key: api.settings?.api_key ?? '',
          },
        }
      : emptyExternalAPIFormData,
  )
  const hasEmptyInputs = Object.values(formData).some((value) =>
    typeof value === 'string'
      ? value.trim() === ''
      : Object.values(value).some((v) => v.trim() === ''),
  )
  const handleDataChange = (val: CreateExternalAPIReq) => {
    if (val.settings.endpoint !== formData.settings.endpoint) setEndpointError(undefined)
    setFormData(val)
  }
  const submit = () => {
    setShowConfirm(false)
    onSubmit({
      ...formData,
      settings: { ...formData.settings, endpoint: formData.settings.endpoint.trim() },
    })
  }
  const handleSubmit = () => {
    if (hasEmptyInputs || pending) return

    const endpoint = formData.settings.endpoint.trim()
    if (!isValidHttpEndpoint(endpoint)) {
      setEndpointError(t(($) => $['validation.invalidHttpUrl'], { ns: 'dataset' }))
      return
    }
    if (formData.settings.api_key.length < 5) {
      toast.error(t(($) => $['apiBasedExtension.modal.apiKey.lengthError'], { ns: 'common' }))
      return
    }

    if (api && (datasetBindings?.length ?? 0) > 0) setShowConfirm(true)
    else submit()
  }

  return (
    <>
      <DialogBody>
        <fieldset disabled={pending}>
          <ExternalAPIForm
            id={formId}
            value={formData}
            onChange={handleDataChange}
            onSubmit={(event) => {
              event.preventDefault()
              handleSubmit()
            }}
            formSchemas={formSchemas}
            errors={{ endpoint: endpointError }}
          />
        </fieldset>
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button disabled={pending} type="button" variant="secondary" />}>
          {t(($) => $['externalAPIForm.cancel'], { ns: 'dataset' })}
        </DialogClose>
        <Button
          form={formId}
          type="submit"
          variant="primary"
          loading={pending}
          disabled={hasEmptyInputs}
        >
          {t(($) => $['externalAPIForm.save'], { ns: 'dataset' })}
        </Button>
      </DialogFooter>
      <EncryptedBottom
        front={t(($) => $['externalAPIForm.encrypted.front'], { ns: 'dataset' })}
        back={t(($) => $['externalAPIForm.encrypted.end'], { ns: 'dataset' })}
      />
      <AlertDialog
        open={showConfirm && (datasetBindings?.length ?? 0) > 0}
        onOpenChange={(open) => !open && setShowConfirm(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $.editExternalAPIFormTitle, { ns: 'dataset' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {`${t(($) => $['editExternalAPIConfirmWarningContent.front'], { ns: 'dataset' })} ${datasetBindings?.length} ${t(($) => $['editExternalAPIConfirmWarningContent.end'], { ns: 'dataset' })}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={submit}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
export default ExternalApiEditor
