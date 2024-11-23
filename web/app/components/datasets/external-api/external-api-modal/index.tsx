import type { FC } from 'react'
import {
  memo,
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiBook2Line,
  RiCloseLine,
  RiInformation2Line,
  RiLock2Fill,
} from '@remixicon/react'
import type { CreateExternalAPIReq, FormSchema } from '../declarations'
import Form from './Form'
import ActionButton from '@/app/components/base/action-button'
import Confirm from '@/app/components/base/confirm'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
} from '@/app/components/base/portal-to-follow-elem'
import { createExternalAPI } from '@/service/datasets'
import { useToastContext } from '@/app/components/base/toast'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'

type AddExternalAPIModalProps = {
  data?: CreateExternalAPIReq
  onSave: (formValue: CreateExternalAPIReq) => void
  onCancel: () => void
  onEdit?: (formValue: CreateExternalAPIReq) => Promise<void>
  datasetBindings?: { id: string; name: string }[]
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
      notify({ type: 'error', message: t('common.apiBasedExtension.modal.apiKey.lengthError') })
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
      <PortalToFollowElemContent className='w-full h-full z-[60]'>
        <div className='fixed inset-0 flex items-center justify-center bg-black/[.25]'>
          <div className='flex relative w-[480px] flex-col items-start bg-components-panel-bg rounded-2xl border-[0.5px] border-components-panel-border shadows-shadow-xl'>
            <div className='flex flex-col pt-6 pl-6 pb-3 pr-14 items-start gap-2 self-stretch'>
              <div className='self-stretch text-text-primary title-2xl-semi-bold flex-grow'>
                {
                  isEditMode ? t('dataset.editExternalAPIFormTitle') : t('dataset.createExternalAPI')
                }
              </div>
              {isEditMode && (datasetBindings?.length ?? 0) > 0 && (
                <div className='text-text-tertiary system-xs-regular flex items-center'>
                  {t('dataset.editExternalAPIFormWarning.front')}
                  <span className='text-text-accent cursor-pointer flex items-center'>
                    &nbsp;{datasetBindings?.length} {t('dataset.editExternalAPIFormWarning.end')}&nbsp;
                    <Tooltip
                      popupClassName='flex items-center self-stretch w-[320px]'
                      popupContent={
                        <div className='p-1'>
                          <div className='flex pt-1 pb-0.5 pl-2 pr-3 items-start self-stretch'>
                            <div className='text-text-tertiary system-xs-medium-uppercase'>{`${datasetBindings?.length} ${t('dataset.editExternalAPITooltipTitle')}`}</div>
                          </div>
                          {datasetBindings?.map(binding => (
                            <div key={binding.id} className='flex px-2 py-1 items-center gap-1 self-stretch'>
                              <RiBook2Line className='w-4 h-4 text-text-secondary' />
                              <div className='text-text-secondary system-sm-medium'>{binding.name}</div>
                            </div>
                          ))}
                        </div>
                      }
                      asChild={false}
                      position='bottom'
                    >
                      <RiInformation2Line className='w-3.5 h-3.5' />
                    </Tooltip>
                  </span>
                </div>
              )}
            </div>
            <ActionButton className='absolute top-5 right-5' onClick={onCancel}>
              <RiCloseLine className='w-[18px] h-[18px] text-text-tertiary flex-shrink-0' />
            </ActionButton>
            <Form
              value={formData}
              onChange={handleDataChange}
              formSchemas={formSchemas}
              className='flex px-6 py-3 flex-col justify-center items-start gap-4 self-stretch'
            />
            <div className='flex p-6 pt-5 justify-end items-center gap-2 self-stretch'>
              <Button type='button' variant='secondary' onClick={onCancel}>
                {t('dataset.externalAPIForm.cancel')}
              </Button>
              <Button
                type='submit'
                variant='primary'
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
                {t('dataset.externalAPIForm.save')}
              </Button>
            </div>
            <div className='flex px-2 py-3 justify-center items-center gap-1 self-stretch rounded-b-2xl
              border-t-[0.5px] border-divider-subtle bg-background-soft text-text-tertiary system-xs-regular'
            >
              <RiLock2Fill className='w-3 h-3 text-text-quaternary' />
              {t('dataset.externalAPIForm.encrypted.front')}
              <a
                className='text-text-accent'
                target='_blank' rel='noopener noreferrer'
                href='https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html'
              >
                PKCS1_OAEP
              </a>
              {t('dataset.externalAPIForm.encrypted.end')}
            </div>
          </div>
          {showConfirm && (datasetBindings?.length ?? 0) > 0 && (
            <Confirm
              isShow={showConfirm}
              type='warning'
              title='Warning'
              content={`${t('dataset.editExternalAPIConfirmWarningContent.front')} ${datasetBindings?.length} ${t('dataset.editExternalAPIConfirmWarningContent.end')}`}
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
