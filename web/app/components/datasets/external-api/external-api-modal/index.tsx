import type { FC } from 'react'
import type { CreateExternalAPIReq, FormSchema } from '../declarations'
import {
  RiBook2Line,
  RiCloseLine,
  RiInformation2Line,
  RiLock2Fill,
} from '@remixicon/react'
import {
  memo,
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import Confirm from '@/app/components/base/confirm'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
} from '@/app/components/base/portal-to-follow-elem'
import { useToastContext } from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import { createExternalAPI } from '@/service/datasets'
import Form from './Form'

type AddExternalAPIModalProps = {
  data?: CreateExternalAPIReq
  onSave: (formValue: CreateExternalAPIReq) => void
  onCancel: () => void
  onEdit?: (formValue: CreateExternalAPIReq) => Promise<void>
  datasetBindings?: { id: string, name: string }[]
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

const AddExternalAPIModal: FC<AddExternalAPIModalProps> = ({ data, onSave, onCancel, datasetBindings, isEditMode, onEdit }) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [loading, setLoading] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [formData, setFormData] = useState<CreateExternalAPIReq>({ name: '', settings: { endpoint: '', api_key: '' } })

  useEffect(() => {
    if (isEditMode && data)
      setFormData(data)
  }, [isEditMode, data])

  const hasEmptyInputs = Object.values(formData).some(value =>
    typeof value === 'string' ? value.trim() === '' : Object.values(value).some(v => v.trim() === ''),
  )
  const handleDataChange = (val: CreateExternalAPIReq) => {
    setFormData(val)
  }

  const handleSave = async () => {
    if (formData && formData.settings.api_key && formData.settings.api_key?.length < 5) {
      notify({ type: 'error', message: t('apiBasedExtension.modal.apiKey.lengthError', { ns: 'common' }) })
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      if (isEditMode && onEdit) {
        await onEdit(
          {
            ...formData,
            settings: { ...formData.settings, api_key: formData.settings.api_key ? '[__HIDDEN__]' : formData.settings.api_key },
          },
        )
        notify({ type: 'success', message: 'External API updated successfully' })
      }
      else {
        const res = await createExternalAPI({ body: formData })
        if (res && res.id) {
          notify({ type: 'success', message: 'External API saved successfully' })
          onSave(res)
        }
      }
      onCancel()
    }
    catch (error) {
      console.error('Error saving/updating external API:', error)
      notify({ type: 'error', message: 'Failed to save/update External API' })
    }
    finally {
      setLoading(false)
    }
  }

  return (
    <PortalToFollowElem open>
      <PortalToFollowElemContent className="z-[60] h-full w-full">
        <div className="fixed inset-0 flex items-center justify-center bg-black/[.25]">
          <div className="shadows-shadow-xl relative flex w-[480px] flex-col items-start rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg">
            <div className="flex flex-col items-start gap-2 self-stretch pb-3 pl-6 pr-14 pt-6">
              <div className="title-2xl-semi-bold grow self-stretch text-text-primary">
                {
                  isEditMode ? t('editExternalAPIFormTitle', { ns: 'dataset' }) : t('createExternalAPI', { ns: 'dataset' })
                }
              </div>
              {isEditMode && (datasetBindings?.length ?? 0) > 0 && (
                <div className="system-xs-regular flex items-center text-text-tertiary">
                  {t('editExternalAPIFormWarning.front', { ns: 'dataset' })}
                  <span className="flex cursor-pointer items-center text-text-accent">
                    &nbsp;
                    {datasetBindings?.length}
                    {' '}
                    {t('editExternalAPIFormWarning.end', { ns: 'dataset' })}
&nbsp;
                    <Tooltip
                      popupClassName="flex items-center self-stretch w-[320px]"
                      popupContent={(
                        <div className="p-1">
                          <div className="flex items-start self-stretch pb-0.5 pl-2 pr-3 pt-1">
                            <div className="system-xs-medium-uppercase text-text-tertiary">{`${datasetBindings?.length} ${t('editExternalAPITooltipTitle', { ns: 'dataset' })}`}</div>
                          </div>
                          {datasetBindings?.map(binding => (
                            <div key={binding.id} className="flex items-center gap-1 self-stretch px-2 py-1">
                              <RiBook2Line className="h-4 w-4 text-text-secondary" />
                              <div className="system-sm-medium text-text-secondary">{binding.name}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      asChild={false}
                      position="bottom"
                    >
                      <RiInformation2Line className="h-3.5 w-3.5" />
                    </Tooltip>
                  </span>
                </div>
              )}
            </div>
            <ActionButton className="absolute right-5 top-5" onClick={onCancel}>
              <RiCloseLine className="h-[18px] w-[18px] shrink-0 text-text-tertiary" />
            </ActionButton>
            <Form
              value={formData}
              onChange={handleDataChange}
              formSchemas={formSchemas}
              className="flex flex-col items-start justify-center gap-4 self-stretch px-6 py-3"
            />
            <div className="flex items-center justify-end gap-2 self-stretch p-6 pt-5">
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
            <div className="system-xs-regular flex items-center justify-center gap-1 self-stretch rounded-b-2xl border-t-[0.5px]
              border-divider-subtle bg-background-soft px-2 py-3 text-text-tertiary"
            >
              <RiLock2Fill className="h-3 w-3 text-text-quaternary" />
              {t('externalAPIForm.encrypted.front', { ns: 'dataset' })}
              <a
                className="text-text-accent"
                target="_blank"
                rel="noopener noreferrer"
                href="https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html"
              >
                PKCS1_OAEP
              </a>
              {t('externalAPIForm.encrypted.end', { ns: 'dataset' })}
            </div>
          </div>
          {showConfirm && (datasetBindings?.length ?? 0) > 0 && (
            <Confirm
              isShow={showConfirm}
              type="warning"
              title="Warning"
              content={`${t('editExternalAPIConfirmWarningContent.front', { ns: 'dataset' })} ${datasetBindings?.length} ${t('editExternalAPIConfirmWarningContent.end', { ns: 'dataset' })}`}
              onCancel={() => setShowConfirm(false)}
              onConfirm={handleSave}
            />
          )}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(AddExternalAPIModal)
