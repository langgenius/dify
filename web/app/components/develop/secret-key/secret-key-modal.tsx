'use client'
import {
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiDeleteBinLine } from '@remixicon/react'
import { PlusIcon, XMarkIcon } from '@heroicons/react/20/solid'
import useSWR from 'swr'
import SecretKeyGenerateModal from './secret-key-generate'
import s from './style.module.css'
import ActionButton from '@/app/components/base/action-button'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import CopyFeedback from '@/app/components/base/copy-feedback'
import {
  createApikey as createAppApikey,
  delApikey as delAppApikey,
} from '@/service/apps'
import {
  createApikey as createDatasetApikey,
  delApikey as delDatasetApikey,
  fetchApiKeysList as fetchDatasetApiKeysList,
} from '@/service/datasets'
import type { CreateApiKeyResponse } from '@/models/app'
import Loading from '@/app/components/base/loading'
import Confirm from '@/app/components/base/confirm'
import useTimestamp from '@/hooks/use-timestamp'
import { useAppContext } from '@/context/app-context'
import { useAppApiKeys, useInvalidateAppApiKeys } from '@/service/use-apps'

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
  const invalidateAppApiKeys = useInvalidateAppApiKeys()
  const { data: appApiKeys, isLoading: isAppApiKeysLoading } = useAppApiKeys(appId, { enabled: !!appId && isShow })
  const { data: datasetApiKeys, isLoading: isDatasetApiKeysLoading, mutate: mutateDatasetApiKeys } = useSWR(
    !appId && isShow ? { url: '/datasets/api-keys', params: {} } : null,
    fetchDatasetApiKeysList,
  )
  const apiKeysList = appId ? appApiKeys : datasetApiKeys
  const isApiKeysLoading = appId ? isAppApiKeysLoading : isDatasetApiKeysLoading

  const [delKeyID, setDelKeyId] = useState('')

  const onDel = async () => {
    setShowConfirmDelete(false)
    if (!delKeyID)
      return

    const delApikey = appId ? delAppApikey : delDatasetApikey
    const params = appId
      ? { url: `/apps/${appId}/api-keys/${delKeyID}`, params: {} }
      : { url: `/datasets/api-keys/${delKeyID}`, params: {} }
    await delApikey(params)
    if (appId)
      invalidateAppApiKeys(appId)
    else
      mutateDatasetApiKeys()
  }

  const onCreate = async () => {
    const params = appId
      ? { url: `/apps/${appId}/api-keys`, body: {} }
      : { url: '/datasets/api-keys', body: {} }
    const createApikey = appId ? createAppApikey : createDatasetApikey
    const res = await createApikey(params)
    setVisible(true)
    setNewKey(res)
    if (appId)
      invalidateAppApiKeys(appId)
    else
      mutateDatasetApiKeys()
  }

  const generateToken = (token: string) => {
    return `${token.slice(0, 3)}...${token.slice(-20)}`
  }

  return (
    <Modal isShow={isShow} onClose={onClose} title={`${t('appApi.apiKeyModal.apiSecretKey')}`} className={`${s.customModal} flex flex-col px-8`}>
      <div className="-mr-2 -mt-6 mb-4 flex justify-end">
        <XMarkIcon className="h-6 w-6 cursor-pointer text-text-tertiary" onClick={onClose} />
      </div>
      <p className='mt-1 shrink-0 text-[13px] font-normal leading-5 text-text-tertiary'>{t('appApi.apiKeyModal.apiSecretKeyTips')}</p>
      {isApiKeysLoading && <div className='mt-4'><Loading /></div>}
      {
        !!apiKeysList?.data?.length && (
          <div className='mt-4 flex grow flex-col overflow-hidden'>
            <div className='flex h-9 shrink-0 items-center border-b border-divider-regular text-xs font-semibold text-text-tertiary'>
              <div className='w-64 shrink-0 px-3'>{t('appApi.apiKeyModal.secretKey')}</div>
              <div className='w-[200px] shrink-0 px-3'>{t('appApi.apiKeyModal.created')}</div>
              <div className='w-[200px] shrink-0 px-3'>{t('appApi.apiKeyModal.lastUsed')}</div>
              <div className='grow px-3'></div>
            </div>
            <div className='grow overflow-auto'>
              {apiKeysList.data.map(api => (
                <div className='flex h-9 items-center border-b border-divider-regular text-sm font-normal text-text-secondary' key={api.id}>
                  <div className='w-64 shrink-0 truncate px-3 font-mono'>{generateToken(api.token)}</div>
                  <div className='w-[200px] shrink-0 truncate px-3'>{formatTime(Number(api.created_at), t('appLog.dateTimeFormat') as string)}</div>
                  <div className='w-[200px] shrink-0 truncate px-3'>{api.last_used_at ? formatTime(Number(api.last_used_at), t('appLog.dateTimeFormat') as string) : t('appApi.never')}</div>
                  <div className='flex grow space-x-2 px-3'>
                    <CopyFeedback content={api.token} />
                    {isCurrentWorkspaceManager && (
                      <ActionButton
                        onClick={() => {
                          setDelKeyId(api.id)
                          setShowConfirmDelete(true)
                        }}
                      >
                        <RiDeleteBinLine className='h-4 w-4' />
                      </ActionButton>
                    )}
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
          <div className='text-xs font-medium text-text-secondary'>{t('appApi.apiKeyModal.createNewSecretKey')}</div>
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
