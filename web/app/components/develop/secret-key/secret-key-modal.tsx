'use client'
import {
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { PlusIcon, XMarkIcon } from '@heroicons/react/20/solid'
import useSWR, { useSWRConfig } from 'swr'
import SecretKeyGenerateModal from './secret-key-generate'
import s from './style.module.css'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { createApikey, delApikey, fetchApiKeysList } from '@/service/apps'
import type { CreateApiKeyResponse } from '@/models/app'
import Tooltip from '@/app/components/base/tooltip'
import Loading from '@/app/components/base/loading'
import Confirm from '@/app/components/base/confirm'
import useCopyToClipboard from '@/hooks/use-copy-to-clipboard'
import { useContext } from 'use-context-selector'
import I18n from '@/context/i18n'

type ISecretKeyModalProps = {
  isShow: boolean
  appId: string
  onClose: () => void
}

const SecretKeyModal = ({
  isShow = false,
  appId,
  onClose,
}: ISecretKeyModalProps) => {
  const { t } = useTranslation()
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [isVisible, setVisible] = useState(false)
  const [newKey, setNewKey] = useState<CreateApiKeyResponse | undefined>(undefined)
  const { mutate } = useSWRConfig()
  const commonParams = { url: `/apps/${appId}/api-keys`, params: {} }
  const { data: apiKeysList } = useSWR(commonParams, fetchApiKeysList)

  const [delKeyID, setDelKeyId] = useState('')
  const [_, copy] = useCopyToClipboard()

  const { locale } = useContext(I18n)

  // const [isCopied, setIsCopied] = useState(false)
  const [copyValue, setCopyValue] = useState('')

  useEffect(() => {
    if (copyValue) {
      const timeout = setTimeout(() => {
        setCopyValue('')
      }, 1000)

      return () => {
        clearTimeout(timeout)
      }
    }
  }, [copyValue])


  const onDel = async () => {
    setShowConfirmDelete(false)
    if (!delKeyID) {
      return
    }
    await delApikey({ url: `/apps/${appId}/api-keys/${delKeyID}`, params: {} })
    mutate(commonParams)
  }

  const onCreate = async () => {
    const res = await createApikey({ url: `/apps/${appId}/api-keys`, body: {} })
    setVisible(true)
    setNewKey(res)
    mutate(commonParams)
  }

  const generateToken = (token: string) => {
    return `${token.slice(0, 3)}...${token.slice(-20)}`
  }

  const formatDate = (timestamp: any) => {
    if (locale === 'en') {
      return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format((+timestamp) * 1000)
    } else {
      return new Intl.DateTimeFormat('fr-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format((+timestamp) * 1000)
    }
  }

  return (
    <Modal isShow={isShow} onClose={onClose} title={`${t('appApi.apiKeyModal.apiSecretKey')}`} className={`${s.customModal} px-8 flex flex-col`}>
      <XMarkIcon className={`w-6 h-6 absolute cursor-pointer text-gray-500 ${s.close}`} onClick={onClose} />
      <p className='mt-1 text-[13px] text-gray-500 font-normal leading-5 flex-shrink-0'>{t('appApi.apiKeyModal.apiSecretKeyTips')}</p>
      {!apiKeysList && <div className='mt-4'><Loading /></div>}
      {
        !!apiKeysList?.data?.length && (
          <div className='flex flex-col flex-grow mt-4 overflow-hidden'>
            <div className='flex items-center flex-shrink-0 text-xs font-semibold text-gray-500 border-b border-solid h-9'>
              <div className='flex-shrink-0 w-64 px-3'>{t('appApi.apiKeyModal.secretKey')}</div>
              <div className='flex-shrink-0 px-3 w-28'>{t('appApi.apiKeyModal.created')}</div>
              <div className='flex-shrink-0 px-3 w-28'>{t('appApi.apiKeyModal.lastUsed')}</div>
              <div className='flex-grow px-3'></div>
            </div>
            <div className='flex-grow overflow-auto'>
              {apiKeysList.data.map(api => (
                <div className='flex items-center text-sm font-normal text-gray-700 border-b border-solid h-9' key={api.id}>
                  <div className='flex-shrink-0 w-64 px-3 font-mono truncate'>{generateToken(api.token)}</div>
                  <div className='flex-shrink-0 px-3 truncate w-28'>{formatDate(api.created_at)}</div>
                  {/* <div className='flex-shrink-0 px-3 truncate w-28'>{dayjs((+api.created_at) * 1000).format('MMM D, YYYY')}</div> */}
                  {/* <div className='flex-shrink-0 px-3 truncate w-28'>{api.last_used_at ? dayjs((+api.last_used_at) * 1000).format('MMM D, YYYY') : 'Never'}</div> */}
                  <div className='flex-shrink-0 px-3 truncate w-28'>{api.last_used_at ? formatDate(api.last_used_at) : t('appApi.never')}</div>
                  <div className='flex flex-grow px-3'>
                    <Tooltip
                      selector="top-uniq"
                      content={copyValue === api.token ? `${t('appApi.copied')}` : `${t('appApi.copy')}`}
                      className='z-10'
                    >
                      <div className={`flex items-center justify-center flex-shrink-0 w-6 h-6 mr-1 rounded-lg cursor-pointer hover:bg-gray-100 ${s.copyIcon} ${copyValue === api.token ? s.copied : ''}`} onClick={() => {
                        // setIsCopied(true)
                        copy(api.token)
                        setCopyValue(api.token)
                      }}></div>
                    </Tooltip>
                    <div className={`flex items-center justify-center flex-shrink-0 w-6 h-6 rounded-lg cursor-pointer ${s.trashIcon}`} onClick={() => {
                      setDelKeyId(api.id)
                      setShowConfirmDelete(true)
                    }}>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      }
      <div className='flex'>
        <Button type='default' className={`flex flex-shrink-0 mt-4 ${s.autoWidth}`} onClick={() =>
          onCreate()
        }>
          <PlusIcon className='flex flex-shrink-0 w-4 h-4' />
          <div className='text-xs font-medium text-gray-800'>{t('appApi.apiKeyModal.createNewSecretKey')}</div>
        </Button>
      </div>
      <SecretKeyGenerateModal className='flex-shrink-0' isShow={isVisible} onClose={() => setVisible(false)} newKey={newKey} />
      {showConfirmDelete && (
        <Confirm
          title={`${t('appApi.actionMsg.deleteConfirmTitle')}`}
          content={`${t('appApi.actionMsg.deleteConfirmTips')}`}
          isShow={showConfirmDelete}
          onClose={() => {
            setDelKeyId('')
            setShowConfirmDelete(false)
          }}
          onConfirm={onDel}
          onCancel={() => {
            setDelKeyId('')
            setShowConfirmDelete(false)
          }}
        />
      )}
    </Modal >
  )
}

export default SecretKeyModal
