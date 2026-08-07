'use client'
import type { QueryClient, QueryKey } from '@tanstack/react-query'
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
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Loading from '@/app/components/base/loading'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import useTimestamp from '@/hooks/use-timestamp'
import { createApikey as createAppApikey, delApikey as delAppApikey } from '@/service/apps'
import { consoleQuery } from '@/service/client'
import {
  createApikey as createDatasetApikey,
  delApikey as delDatasetApikey,
} from '@/service/datasets'
import { useDatasetApiKeys, useInvalidateDatasetApiKeys } from '@/service/knowledge/use-dataset'
import { useAppApiKeys, useInvalidateAppApiKeys } from '@/service/use-apps'
import SecretKeyGenerateModal from './secret-key-generate'
import s from './style.module.css'

type ISecretKeyModalProps = {
  isShow: boolean
  appId?: string
  canManage: boolean
  environmentId?: string
  onClose: () => void
}

const SecretKeyModal = ({
  isShow = false,
  appId,
  canManage,
  environmentId,
  onClose,
}: ISecretKeyModalProps) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()
  const queryClient = useQueryClient()
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [newKey, setNewKey] = useState<Pick<CreateApiKeyResponse, 'token'> | undefined>(undefined)
  const invalidateAppApiKeys = useInvalidateAppApiKeys()
  const invalidateDatasetApiKeys = useInvalidateDatasetApiKeys()
  const { data: appApiKeys, isLoading: isAppApiKeysLoading } = useAppApiKeys(appId, {
    enabled: !!appId && !environmentId && isShow,
  })
  const { data: datasetApiKeys, isLoading: isDatasetApiKeysLoading } = useDatasetApiKeys({
    enabled: !appId && isShow,
  })
  const environmentParams =
    appId && environmentId
      ? {
          app_id: appId,
          environment_id: environmentId,
        }
      : undefined
  const environmentApiKeysQueryOptions =
    consoleQuery.enterprise.appDeploy.accessService.listEnvironmentApiKeys.queryOptions({
      input: environmentParams ? { params: environmentParams } : skipToken,
    })
  const environmentApiKeysQuery = useQuery({
    ...environmentApiKeysQueryOptions,
    enabled: Boolean(environmentParams) && isShow,
  })
  const createEnvironmentApiKeyMutation = useMutation(
    consoleQuery.enterprise.appDeploy.accessService.createEnvironmentApiKey.mutationOptions(),
  )
  const deleteEnvironmentApiKeyMutation = useMutation(
    consoleQuery.enterprise.appDeploy.accessService.deleteEnvironmentApiKey.mutationOptions(),
  )
  const isEnvironmentScope = Boolean(environmentParams)
  const apiKeysList = isEnvironmentScope
    ? environmentApiKeysQuery.data
    : appId
      ? appApiKeys
      : datasetApiKeys
  const isApiKeysLoading = isEnvironmentScope
    ? environmentApiKeysQuery.isLoading
    : appId
      ? isAppApiKeysLoading
      : isDatasetApiKeysLoading

  const [delKeyID, setDelKeyId] = useState('')

  const onDel = async () => {
    setShowConfirmDelete(false)
    if (!canManage) return
    if (!delKeyID) return

    if (environmentParams) {
      deleteEnvironmentApiKeyMutation.mutate(
        {
          params: {
            ...environmentParams,
            api_key_id: delKeyID,
          },
        },
        {
          onSuccess: () => {
            setDelKeyId('')
            void invalidateEnvironmentApiKeys(
              queryClient,
              environmentParams,
              environmentApiKeysQueryOptions.queryKey,
            )
          },
        },
      )
      return
    }

    const delApikey = appId ? delAppApikey : delDatasetApikey
    const params = appId
      ? { url: `/apps/${appId}/api-keys/${delKeyID}`, params: {} }
      : { url: `/datasets/api-keys/${delKeyID}`, params: {} }
    await delApikey(params)
    if (appId) invalidateAppApiKeys(appId)
    else invalidateDatasetApiKeys()
  }

  const onCreate = async () => {
    if (!currentWorkspace.id || !canManage) return

    if (environmentParams) {
      createEnvironmentApiKeyMutation.mutate(
        { params: environmentParams },
        {
          onSuccess: (createdKey) => {
            setIsVisible(true)
            setNewKey(createdKey)
            void invalidateEnvironmentApiKeys(
              queryClient,
              environmentParams,
              environmentApiKeysQueryOptions.queryKey,
            )
          },
        },
      )
      return
    }

    const params = appId
      ? { url: `/apps/${appId}/api-keys`, body: {} }
      : { url: '/datasets/api-keys', body: {} }
    const createApikey = appId ? createAppApikey : createDatasetApikey
    const res = await createApikey(params)
    setIsVisible(true)
    setNewKey(res)
    if (appId) invalidateAppApiKeys(appId)
    else invalidateDatasetApiKeys()
  }

  const generateToken = (token: string) => {
    return `${token.slice(0, 3)}...${token.slice(-20)}`
  }

  const handleDeleteConfirmOpenChange = (open: boolean) => {
    if (open) return

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
          if (!open) handleClose()
        }}
      >
        <DialogContent
          className={cn(
            'max-h-[calc(100vh-80px)]! w-full max-w-200! overflow-hidden! border-none text-left align-middle',
            `${s.customModal} flex flex-col px-8`,
          )}
        >
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {`${t(($) => $['apiKeyModal.apiSecretKey'], { ns: 'appApi' })}`}
          </DialogTitle>

          <div className="-mt-6 -mr-2 mb-4 flex justify-end">
            <button
              type="button"
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              className="flex size-6 cursor-pointer items-center justify-center text-text-tertiary"
              onClick={handleClose}
            >
              <span
                className="i-heroicons-x-mark-20-solid size-6 cursor-pointer"
                aria-hidden="true"
              />
            </button>
          </div>
          <p className="mt-1 shrink-0 text-[13px] leading-5 font-normal text-text-tertiary">
            {t(($) => $['apiKeyModal.apiSecretKeyTips'], { ns: 'appApi' })}
          </p>
          {isApiKeysLoading && (
            <div className="mt-4">
              <Loading />
            </div>
          )}
          {!!apiKeysList?.data?.length && (
            <div className="mt-4 flex grow flex-col overflow-hidden">
              <div className="flex h-9 shrink-0 items-center border-b border-divider-regular text-xs font-semibold text-text-tertiary">
                <div className="w-64 shrink-0 px-3">
                  {t(($) => $['apiKeyModal.secretKey'], { ns: 'appApi' })}
                </div>
                <div className="w-50 shrink-0 px-3">
                  {t(($) => $['apiKeyModal.created'], { ns: 'appApi' })}
                </div>
                <div className="w-50 shrink-0 px-3">
                  {t(($) => $['apiKeyModal.lastUsed'], { ns: 'appApi' })}
                </div>
                <div className="grow px-3"></div>
              </div>
              <div className="grow overflow-auto">
                {apiKeysList.data.map((api) => (
                  <div
                    className="flex h-9 items-center border-b border-divider-regular text-sm font-normal text-text-secondary"
                    key={api.id}
                  >
                    <div className="w-64 shrink-0 truncate px-3 font-mono">
                      {generateToken(api.token)}
                    </div>
                    <div className="w-50 shrink-0 truncate px-3">
                      {formatTime(
                        Number(api.created_at),
                        t(($) => $.dateTimeFormat, { ns: 'appLog' }) as string,
                      )}
                    </div>
                    <div className="w-50 shrink-0 truncate px-3">
                      {api.last_used_at
                        ? formatTime(
                            Number(api.last_used_at),
                            t(($) => $.dateTimeFormat, { ns: 'appLog' }) as string,
                          )
                        : t(($) => $.never, { ns: 'appApi' })}
                    </div>
                    <div className="flex grow space-x-2 px-3">
                      <CopyFeedback content={api.token} />
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
          )}
          <div className="flex">
            <Button
              className={`mt-4 flex shrink-0 ${s.autoWidth}`}
              onClick={onCreate}
              disabled={
                !currentWorkspace.id || !canManage || createEnvironmentApiKeyMutation.isPending
              }
              loading={createEnvironmentApiKeyMutation.isPending}
            >
              <span className="i-heroicons-plus-20-solid flex size-4 shrink-0" />
              <div className="text-xs font-medium text-text-secondary">
                {t(($) => $['apiKeyModal.createNewSecretKey'], { ns: 'appApi' })}
              </div>
            </Button>
          </div>
          <AlertDialog open={showConfirmDelete} onOpenChange={handleDeleteConfirmOpenChange}>
            <AlertDialogContent>
              <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
                <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                  {t(($) => $['actionMsg.deleteConfirmTitle'], { ns: 'appApi' })}
                </AlertDialogTitle>
                <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                  {t(($) => $['actionMsg.deleteConfirmTips'], { ns: 'appApi' })}
                </AlertDialogDescription>
              </div>
              <AlertDialogActions>
                <AlertDialogCancelButton>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton
                  loading={deleteEnvironmentApiKeyMutation.isPending}
                  onClick={onDel}
                >
                  {t(($) => $['operation.confirm'], { ns: 'common' })}
                </AlertDialogConfirmButton>
              </AlertDialogActions>
            </AlertDialogContent>
          </AlertDialog>
        </DialogContent>
      </Dialog>
      {isShow && (
        <SecretKeyGenerateModal
          className="shrink-0"
          isShow={isVisible}
          onClose={() => setIsVisible(false)}
          newKey={newKey}
        />
      )}
    </>
  )
}

export default SecretKeyModal

async function invalidateEnvironmentApiKeys(
  queryClient: QueryClient,
  params: {
    app_id: string
    environment_id: string
  },
  apiKeysQueryKey: QueryKey,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: apiKeysQueryKey }),
    queryClient.invalidateQueries({
      queryKey: consoleQuery.enterprise.appDeploy.accessService.getEnvironmentApi.queryOptions({
        input: { params },
      }).queryKey,
    }),
  ])
}
