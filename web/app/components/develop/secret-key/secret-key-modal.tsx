'use client'
import type { CreateApiKeyResponse } from '@/models/app'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Radio } from '@langgenius/dify-ui/radio'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import {
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import useTimestamp from '@/hooks/use-timestamp'
import {
  createApikey as createAppApikey,
  delApikey as delAppApikey,
} from '@/service/apps'
import {
  createApikey as createDatasetApikey,
  delApikey as delDatasetApikey,
} from '@/service/datasets'
import { useDatasetApiKeys, useDatasetScopedApiKeys, useInvalidateDatasetApiKeys } from '@/service/knowledge/use-dataset'
import { useAppApiKeys, useInvalidateAppApiKeys } from '@/service/use-apps'
import SecretKeyGenerateModal from './secret-key-generate'
import s from './style.module.css'

type DatasetKeyScope = 'dataset' | 'workspace'

type ISecretKeyModalProps = {
  isShow: boolean
  appId?: string
  // When set (and appId is not), the modal manages keys for this knowledge base:
  // it lists every key that can reach it and can create keys bound to it.
  datasetId?: string
  canManage: boolean
  onClose: () => void
}

const SecretKeyModal = ({
  isShow = false,
  appId,
  datasetId,
  canManage,
  onClose,
}: ISecretKeyModalProps) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const { currentWorkspace } = useAppContext()
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [newKey, setNewKey] = useState<CreateApiKeyResponse | undefined>(undefined)
  const [newKeyScope, setNewKeyScope] = useState<DatasetKeyScope>('dataset')
  const invalidateAppApiKeys = useInvalidateAppApiKeys()
  const invalidateDatasetApiKeys = useInvalidateDatasetApiKeys()
  const { data: appApiKeys, isLoading: isAppApiKeysLoading } = useAppApiKeys(appId, { enabled: !!appId && isShow })
  const { data: datasetApiKeys, isLoading: isDatasetApiKeysLoading } = useDatasetApiKeys({ enabled: !appId && !datasetId && isShow })
  const { data: datasetScopedApiKeys, isLoading: isDatasetScopedApiKeysLoading } = useDatasetScopedApiKeys(datasetId, { enabled: !appId && isShow })
  const isDatasetScope = !appId && !!datasetId
  const apiKeysList = appId ? appApiKeys : (isDatasetScope ? datasetScopedApiKeys : datasetApiKeys)
  const isApiKeysLoading = appId ? isAppApiKeysLoading : (isDatasetScope ? isDatasetScopedApiKeysLoading : isDatasetApiKeysLoading)

  const [delKeyID, setDelKeyId] = useState('')

  const onDel = async () => {
    setShowConfirmDelete(false)
    if (!canManage)
      return
    if (!delKeyID)
      return

    const deletedKey = apiKeysList?.data?.find(api => api.id === delKeyID)
    const delApikey = appId ? delAppApikey : delDatasetApikey
    const params = appId
      ? { url: `/apps/${appId}/api-keys/${delKeyID}`, params: {} }
      // Bound keys are managed on the per-dataset route; workspace keys on the tenant route.
      : deletedKey?.dataset_id
        ? { url: `/datasets/${deletedKey.dataset_id}/api-keys/${delKeyID}`, params: {} }
        : { url: `/datasets/api-keys/${delKeyID}`, params: {} }
    await delApikey(params)
    if (appId)
      invalidateAppApiKeys(appId)
    else
      invalidateDatasetApiKeys()
  }

  const onCreate = async () => {
    if (!currentWorkspace || !canManage)
      return

    const params = appId
      ? { url: `/apps/${appId}/api-keys`, body: {} }
      : isDatasetScope && newKeyScope === 'dataset'
        ? { url: `/datasets/${datasetId}/api-keys`, body: {} }
        : { url: '/datasets/api-keys', body: {} }
    const createApikey = appId ? createAppApikey : createDatasetApikey
    const res = await createApikey(params)
    setIsVisible(true)
    setNewKey(res)
    if (appId)
      invalidateAppApiKeys(appId)
    else
      invalidateDatasetApiKeys()
  }

  const getScopeLabel = (keyDatasetId?: string | null) => {
    if (!keyDatasetId)
      return t('apiKeyModal.scopeAllDatasets', { ns: 'appApi' })
    return isDatasetScope
      ? t('apiKeyModal.scopeThisDataset', { ns: 'appApi' })
      : t('apiKeyModal.scopeBoundDataset', { ns: 'appApi' })
  }

  const handleDeleteConfirmOpenChange = (open: boolean) => {
    if (open)
      return

    setDelKeyId('')
    setShowConfirmDelete(false)
  }

  const handleClose = () => {
    setIsVisible(false)
    onClose()
  }

  return (
    <>
      <Dialog
        open={isShow}
        onOpenChange={(open) => {
          if (!open)
            handleClose()
        }}
      >
        <DialogContent className={cn('max-h-[calc(100vh-80px)]! w-full max-w-[800px]! overflow-hidden! border-none text-left align-middle', `${s.customModal} flex flex-col px-8`)}>
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {`${t('apiKeyModal.apiSecretKey', { ns: 'appApi' })}`}
          </DialogTitle>

          <div className="-mt-6 -mr-2 mb-4 flex justify-end">
            <button type="button" aria-label={t('operation.cancel', { ns: 'common' })} className="border-none bg-transparent p-0 text-text-tertiary" onClick={handleClose}>
              <span className="i-heroicons-x-mark-20-solid size-6 cursor-pointer" />
            </button>
          </div>
          <p className="mt-1 shrink-0 text-[13px] leading-5 font-normal text-text-tertiary">{t('apiKeyModal.apiSecretKeyTips', { ns: 'appApi' })}</p>
          {isApiKeysLoading && <div className="mt-4"><Loading /></div>}
          {
            !!apiKeysList?.data?.length && (
              <div className="mt-4 flex grow flex-col overflow-hidden">
                <div className="flex h-9 shrink-0 items-center border-b border-divider-regular text-xs font-semibold text-text-tertiary">
                  <div className="min-w-0 flex-[1.8] truncate px-3">{t('apiKeyModal.secretKey', { ns: 'appApi' })}</div>
                  {!appId && <div className="min-w-0 flex-[1.3] truncate px-3">{t('apiKeyModal.scope', { ns: 'appApi' })}</div>}
                  <div className="min-w-0 flex-[1.8] truncate px-3">{t('apiKeyModal.created', { ns: 'appApi' })}</div>
                  <div className="min-w-0 flex-[1.8] truncate px-3">{t('apiKeyModal.lastUsed', { ns: 'appApi' })}</div>
                  <div className="w-20 shrink-0 px-3"></div>
                </div>
                <div className="grow overflow-x-hidden overflow-y-auto">
                  {apiKeysList.data.map(api => (
                    <div className="flex h-9 items-center border-b border-divider-regular text-sm font-normal text-text-secondary" key={api.id}>
                      <div className="min-w-0 flex-[1.8] truncate px-3 font-mono">{api.token}</div>
                      {!appId && <div className="min-w-0 flex-[1.3] truncate px-3" title={getScopeLabel(api.dataset_id)}>{getScopeLabel(api.dataset_id)}</div>}
                      <div className="min-w-0 flex-[1.8] truncate px-3">{formatTime(Number(api.created_at), t('dateTimeFormat', { ns: 'appLog' }) as string)}</div>
                      <div className="min-w-0 flex-[1.8] truncate px-3">{api.last_used_at ? formatTime(Number(api.last_used_at), t('dateTimeFormat', { ns: 'appLog' }) as string) : t('never', { ns: 'appApi' })}</div>
                      <div className="flex w-20 shrink-0 justify-end space-x-2 px-3">
                        {canManage && (
                          <ActionButton
                            onClick={() => {
                              setDelKeyId(api.id)
                              setShowConfirmDelete(true)
                            }}
                          >
                            <span className="i-ri-delete-bin-line size-4" />
                          </ActionButton>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          }
          {isDatasetScope && (
            <RadioGroup
              className="mt-4 flex items-center gap-4"
              value={newKeyScope}
              onValueChange={value => setNewKeyScope(value as DatasetKeyScope)}
            >
              <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-text-secondary">
                <Radio value="dataset" />
                {t('apiKeyModal.scopeThisDataset', { ns: 'appApi' })}
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-text-secondary">
                <Radio value="workspace" />
                {t('apiKeyModal.scopeAllDatasets', { ns: 'appApi' })}
              </label>
            </RadioGroup>
          )}
          <div className="flex">
            <Button className={`mt-4 flex shrink-0 ${s.autoWidth}`} onClick={onCreate} disabled={!currentWorkspace || !canManage}>
              <span className="mr-1 i-heroicons-plus-20-solid flex size-4 shrink-0" />
              <div className="text-xs font-medium text-text-secondary">{t('apiKeyModal.createNewSecretKey', { ns: 'appApi' })}</div>
            </Button>
          </div>
          <AlertDialog
            open={showConfirmDelete}
            onOpenChange={handleDeleteConfirmOpenChange}
          >
            <AlertDialogContent>
              <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
                <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                  {t('actionMsg.deleteConfirmTitle', { ns: 'appApi' })}
                </AlertDialogTitle>
                <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                  {t('actionMsg.deleteConfirmTips', { ns: 'appApi' })}
                </AlertDialogDescription>
              </div>
              <AlertDialogActions>
                <AlertDialogCancelButton>
                  {t('operation.cancel', { ns: 'common' })}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton onClick={onDel}>
                  {t('operation.confirm', { ns: 'common' })}
                </AlertDialogConfirmButton>
              </AlertDialogActions>
            </AlertDialogContent>
          </AlertDialog>
        </DialogContent>
      </Dialog>
      {isShow && (
        <SecretKeyGenerateModal className="shrink-0" isShow={isVisible} onClose={() => setIsVisible(false)} newKey={newKey} />
      )}
    </>
  )
}

export default SecretKeyModal
