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
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { RiBook2Line, RiInformation2Line } from '@remixicon/react'
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
      <DialogHeader>
        <DialogTitle>
          {api
            ? t(($) => $.editExternalAPIFormTitle, { ns: 'dataset' })
            : t(($) => $.createExternalAPI, { ns: 'dataset' })}
        </DialogTitle>
        {api && (datasetBindings?.length ?? 0) > 0 && (
          <div className="flex items-center system-xs-regular text-text-tertiary">
            {t(($) => $['editExternalAPIFormWarning.front'], { ns: 'dataset' })}
            <span className="flex cursor-pointer items-center text-text-accent">
              &nbsp;
              {datasetBindings?.length}{' '}
              {t(($) => $['editExternalAPIFormWarning.end'], { ns: 'dataset' })}
              &nbsp;
              <Popover>
                <PopoverTrigger
                  openOnHover
                  aria-label={t(($) => $['editExternalAPIFormWarning.end'], { ns: 'dataset' })}
                  render={
                    <button
                      type="button"
                      className="flex size-3.5 items-center justify-center rounded-sm hover:bg-state-base-hover"
                    >
                      <RiInformation2Line className="size-3.5" />
                    </button>
                  }
                />
                <PopoverContent className="flex w-[320px] items-center self-stretch px-3 py-2">
                  <div className="p-1">
                    <div className="flex items-start self-stretch ps-2 pe-3 pt-1 pb-0.5">
                      <div className="system-xs-medium-uppercase text-text-tertiary">{`${datasetBindings?.length} ${t(($) => $.editExternalAPITooltipTitle, { ns: 'dataset' })}`}</div>
                    </div>
                    {datasetBindings?.map((binding) => (
                      <div
                        key={binding.id}
                        className="flex items-center gap-1 self-stretch px-2 py-1"
                      >
                        <RiBook2Line className="size-4 text-text-secondary" />
                        <div className="system-sm-medium text-text-secondary">{binding.name}</div>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </span>
          </div>
        )}
        <DialogHeaderCloseButton
          disabled={pending}
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
        />
      </DialogHeader>
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
