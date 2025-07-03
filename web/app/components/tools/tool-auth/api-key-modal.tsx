import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { RiExternalLinkLine } from '@remixicon/react'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import Modal from '@/app/components/base/modal/modal'

export type ApiKeyModalProps = {
  onClose?: () => void
}
const ApiKeyModal = ({
  onClose,
}: ApiKeyModalProps) => {
  const { t } = useTranslation()

  return (
    <Modal
      size='md'
      title='API Key Authorization Configuration'
      subTitle='After configuring credentials, all members within the workspace can use this tool when orchestrating applications.'
      onClose={onClose}
      onCancel={onClose}
      footerSlot={
        <a
          className='system-xs-regular flex h-8 grow items-center text-text-accent'
          href=''
          target='_blank'
        >
          Get your API Key from OpenAI
          <RiExternalLinkLine className='ml-1 h-3 w-3' />
        </a>
      }
      bottomSlot={
        <div className='flex items-center justify-center bg-background-section-burn py-3 text-xs text-text-tertiary'>
          <Lock01 className='mr-1 h-3 w-3 text-text-tertiary' />
          {t('common.modelProvider.encrypted.front')}
          <a
            className='mx-1 text-text-accent'
            target='_blank' rel='noopener noreferrer'
            href='https://pycryptodome.readthedocs.io/en/latest/src/cipher/oaep.html'
          >
            PKCS1_OAEP
          </a>
          {t('common.modelProvider.encrypted.back')}
        </div>
      }
    >
      <div>oauth</div>
    </Modal>
  )
}

export default memo(ApiKeyModal)
