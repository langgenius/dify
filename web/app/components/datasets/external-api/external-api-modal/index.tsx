import type { FC } from 'react'
import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCloseLine,
  RiInformation2Line,
  RiLock2Fill,
} from '@remixicon/react'
import { useToastContext } from '@/app/components/base/toast'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
} from '@/app/components/base/portal-to-follow-elem'
import ActionButton from '@/app/components/base/action-button'
import Input from '@/app/components/base/input'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'

type AddExternalAPIModalProps = {
  show: boolean
  onHide: () => void
}

const AddExternalAPIModal: FC<AddExternalAPIModalProps> = ({ show, onHide }) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [showConfirm, setShowConfirm] = useState(false)
  const [formData, setFormData] = useState({ name: '', endpoint: '', apiKey: '' })
  const isEditMode = true

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData({ ...formData, [name]: value })
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Handle form submission logic here
    console.log('Form Data:', formData)
    onHide()
  }

  return (
    <PortalToFollowElem open>
      <PortalToFollowElemContent className='w-full h-full z-[60]'>
        <div className='fixed inset-0 flex items-center justify-center bg-black/[.25]'>
          <div className='flex relative w-[480px] flex-col items-start bg-components-panel-bg rounded-2xl border-[0.5px] border-components-panel-border shadows-shadow-xl'>
            <div className='flex flex-col pt-6 pl-6 pb-3 pr-14 items-start gap-2 self-stretch'>
              <div className='self-stretch text-text-primary title-2xl-semi-bold flex-grow'>
                {
                  isEditMode ? t('dataset.editExternalAPIFormTitle') : t('dataset.createExternalAPIFormTitle')
                }
              </div>
              {isEditMode && (
                <div className='text-text-tertiary system-xs-regular flex items-center'>
                  {t('dataset.editExternalAPIFormWarning.front')}
                  <span className='text-text-accent cursor-pointer flex items-center'>
                    &nbsp;3 {t('dataset.editExternalAPIFormWarning.end')}&nbsp;<Tooltip popupContent={'3 LINKED KNOWLEDGE --- needs to be modified'} asChild={false} position='bottom'><RiInformation2Line className='w-3.5 h-3.5' /></Tooltip>
                  </span>
                </div>
              )}
            </div>
            <ActionButton className='absolute top-5 right-5' onClick={onHide}>
              <RiCloseLine className='w-[18px] h-[18px] text-text-tertiary flex-shrink-0' />
            </ActionButton>
            <form onSubmit={handleFormSubmit} className='flex px-6 py-3 flex-col justify-center items-start gap-4 self-stretch'>
              <div className='flex flex-col justify-center items-start gap-4 self-stretch'>
                <div className='flex flex-col items-start gap-1 self-stretch'>
                  <label className='text-text-secondary system-sm-semibold' htmlFor='name'>
                    {t('dataset.externalAPIForm.name')}
                  </label>
                  <Input
                    type='text'
                    id='name'
                    name='name'
                    value={formData.name}
                    onChange={handleInputChange}
                    required
                  />
                </div>
                <div className='flex flex-col items-start gap-1 self-stretch'>
                  <label className='text-text-secondary system-sm-semibold' htmlFor='endpoint'>
                    {t('dataset.externalAPIForm.endpoint')}
                  </label>
                  <Input
                    type='text'
                    id='endpoint'
                    name='endpoint'
                    value={formData.endpoint}
                    onChange={handleInputChange}
                    required
                  />
                </div>
                <div className='flex flex-col items-start gap-1 self-stretch'>
                  <label className='text-text-secondary system-sm-semibold' htmlFor='apiKey'>
                    {t('dataset.externalAPIForm.apiKey')}
                  </label>
                  <Input
                    type='text'
                    id='apiKey'
                    name='apiKey'
                    value={formData.apiKey}
                    onChange={handleInputChange}
                    required
                  />
                </div>
              </div>
            </form>
            <div className='flex p-6 pt-5 justify-end items-center gap-2 self-stretch'>
              <Button type='button' variant='secondary' onClick={onHide}>
                {t('dataset.externalAPIForm.cancel')}
              </Button>
              <Button type='submit' variant='primary'>
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
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(AddExternalAPIModal)
