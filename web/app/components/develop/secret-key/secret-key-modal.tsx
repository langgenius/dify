'use client'
import {
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { PlusIcon, XMarkIcon } from '@heroicons/react/20/solid'
import useSWR, { useSWRConfig } from 'swr'
import copy from 'copy-to-clipboard'
import SecretKeyGenerateModal from './secret-key-generate'
import s from './style.module.css'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import {
  createApikey as createAppApikey,
  delApikey as delAppApikey,
  fetchApiKeysList as fetchAppApiKeysList,
} from '@/service/apps'
import {
  createApikey as createDatasetApikey,
  delApikey as delDatasetApikey,
  fetchApiKeysList as fetchDatasetApiKeysList,
} from '@/service/datasets'
import type { CreateApiKeyResponse } from '@/models/app'
import Tooltip from '@/app/components/base/tooltip'
import Loading from '@/app/components/base/loading'
import Confirm from '@/app/components/base/confirm'
import useTimestamp from '@/hooks/use-timestamp'
import { useAppContext } from '@/context/app-context'

type ISecretKeyModalProps = {
  isShow: boolean
  appId?: string
  onClose: () => void
}

const SecretKeyModal = ({
  isShow = false,
  appId,
  onClose,
}: ISecretKeyModalProps) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const { currentWorkspace, isCurrentWorkspaceManager, isCurrentWorkspaceEditor } = useAppContext()
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [isVisible, setVisible] = useState(false)
  const [newKey, setNewKey] = useState<CreateApiKeyResponse | undefined>(undefined)
  const { mutate } = useSWRConfig()
  const commonParams = appId
    ? { url: `/apps/${appId}/api-keys`, params: {} }
    : { url: '/datasets/api-keys', params: {} }
  const fetchApiKeysList = appId ? fetchAppApiKeysList : fetchDatasetApiKeysList
  const { data: apiKeysList } = useSWR(commonParams, fetchApiKeysList)

  const [delKeyID, setDelKeyId] = useState('')

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
    if (!delKeyID)
      return

    const delApikey = appId ? delAppApikey : delDatasetApikey
    const params = appId
      ? { url: `/apps/${appId}/api-keys/${delKeyID}`, params: {} }
      : { url: `/datasets/api-keys/${delKeyID}`, params: {} }
    await delApikey(params)
    mutate(commonParams)
  }

  const onCreate = async () => {
    const params = appId
      ? { url: `/apps/${appId}/api-keys`, body: {} }
      : { url: '/datasets/api-keys', body: {} }
    const createApikey = appId ? createAppApikey : createDatasetApikey
    const res = await createApikey(params)
    setVisible(true)
    setNewKey(res)
    mutate(commonParams)
  }

  const generateToken = (token: string) => {
    return `${token.slice(0, 3)}...${token.slice(-20)}`
  }

  return (
    <Modal isShow={isShow} onClose={onClose} title={`${t('appApi.apiKeyModal.apiSecretKey')}`} className={`${s.customModal} flex flex-col px-8`}>
      <XMarkIcon className={`text-text-tertiary absolute h-6 w-6 cursor-pointer ${s.close}`} onClick={onClose} />
      <p className='text-text-tertiary mt-1 shrink-0 text-[13px] font-normal leading-5'>{t('appApi.apiKeyModal.apiSecretKeyTips')}</p>
      {!apiKeysList && <div className='mt-4'><Loading /></div>}
      {
        !!apiKeysList?.data?.length && (
          <div className='mt-4 flex grow flex-col overflow-hidden'>
            <div className='text-text-tertiary flex h-9 shrink-0 items-center border-b border-solid text-xs font-semibold'>
              <div className='w-64 shrink-0 px-3'>{t('appApi.apiKeyModal.secretKey')}</div>
              <div className='w-[200px] shrink-0 px-3'>{t('appApi.apiKeyModal.created')}</div>
              <div className='w-[200px] shrink-0 px-3'>{t('appApi.apiKeyModal.lastUsed')}</div>
              <div className='grow px-3'></div>
            </div>
            <div className='grow overflow-auto'>
              {apiKeysList.data.map(api => (
                <div className='text-text-secondary flex h-9 items-center border-b border-solid text-sm font-normal' key={api.id}>
                  <div className='w-64 shrink-0 truncate px-3 font-mono'>{generateToken(api.token)}</div>
                  <div className='w-[200px] shrink-0 truncate px-3'>{formatTime(Number(api.created_at), t('appLog.dateTimeFormat') as string)}</div>
                  <div className='w-[200px] shrink-0 truncate px-3'>{api.last_used_at ? formatTime(Number(api.last_used_at), t('appLog.dateTimeFormat') as string) : t('appApi.never')}</div>
                  <div className='flex grow px-3'>
                    <Tooltip
                      popupContent={copyValue === api.token ? `${t('appApi.copied')}` : `${t('appApi.copy')}`}
                      popupClassName='mr-1'
                    >
                      <div className={`hover:bg-state-base-hover mr-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg ${s.copyIcon} ${copyValue === api.token ? s.copied : ''}`} onClick={() => {
                        // setIsCopied(true)
                        copy(api.token)
                        setCopyValue(api.token)
                      }}></div>
                    </Tooltip>
                    {isCurrentWorkspaceManager
                      && <div className={`flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg ${s.trashIcon}`} onClick={() => {
                        setDelKeyId(api.id)
                        setShowConfirmDelete(true)
                      }}>
                      </div>
                    }
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      }
      <div className='flex'>
        <Button className={`mt-4 flex shrink-0 ${s.autoWidth}`} onClick={onCreate} disabled={!currentWorkspace || !isCurrentWorkspaceEditor}>
          <PlusIcon className='mr-1 flex h-4 w-4 shrink-0' />
          <div className='text-text-secondary text-xs font-medium'>{t('appApi.apiKeyModal.createNewSecretKey')}</div>
        </Button>
      </div>
      <SecretKeyGenerateModal className='shrink-0' isShow={isVisible} onClose={() => setVisible(false)} newKey={newKey} />
      {showConfirmDelete && (
        <Confirm
          title={`${t('appApi.actionMsg.deleteConfirmTitle')}`}
          content={`${t('appApi.actionMsg.deleteConfirmTips')}`}
          isShow={showConfirmDelete}
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
