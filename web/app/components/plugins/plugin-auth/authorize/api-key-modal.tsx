import {
  memo,
  useCallback,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiExternalLinkLine } from '@remixicon/react'
import { Lock01 } from '@/app/components/base/icons/src/vender/solid/security'
import Modal from '@/app/components/base/modal/modal'
import {
  useAddPluginToolCredential,
  useGetPluginToolCredentialSchema,
  useInvalidPluginToolCredentialInfo,
  useUpdatePluginToolCredential,
} from '@/service/use-plugins-auth'
import { CredentialTypeEnum } from '../types'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import type { FromRefObject } from '@/app/components/base/form/types'
import { useToastContext } from '@/app/components/base/toast'

export type ApiKeyModalProps = {
  provider: string
  onClose?: () => void
  editValues?: Record<string, any>
  onRemove?: () => void
}
const ApiKeyModal = ({
  provider,
  onClose,
  editValues,
  onRemove,
}: ApiKeyModalProps) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { data } = useGetPluginToolCredentialSchema(provider, CredentialTypeEnum.API_KEY)
  const { mutateAsync: addPluginToolCredential } = useAddPluginToolCredential(provider)
  const { mutateAsync: updatePluginToolCredential } = useUpdatePluginToolCredential(provider)
  const invalidatePluginToolCredentialInfo = useInvalidPluginToolCredentialInfo(provider)
  const formRef = useRef<FromRefObject>(null)
  const handleConfirm = useCallback(async () => {
    const store = formRef.current?.getFormStore()
    const values = store?.state.values

    if (editValues) {
      await updatePluginToolCredential({
        credentials: values,
        type: CredentialTypeEnum.API_KEY,
      })
    }
    else {
      await addPluginToolCredential({
        credentials: values,
        type: CredentialTypeEnum.API_KEY,
      })
    }
    notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })

    onClose?.()
    invalidatePluginToolCredentialInfo()
  }, [addPluginToolCredential, onClose, invalidatePluginToolCredentialInfo, updatePluginToolCredential, notify, t, editValues])

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
      onConfirm={handleConfirm}
      showExtraButton={!!editValues}
      onExtraButtonClick={onRemove}
    >
      <AuthForm
        ref={formRef}
        formSchemas={data}
        defaultValues={editValues}
      />
    </Modal>
  )
}

export default memo(ApiKeyModal)
