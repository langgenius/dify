'use client'
import type { ApiKeyList as AppApiKeyList } from '@dify/contracts/api/console/apps/types.gen'
import type { ApiKeyList as DatasetApiKeyList } from '@dify/contracts/api/console/datasets/types.gen'
import type { ListEnvironmentApiKeysResponse } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { AlertDialogActions } from '@langgenius/dify-ui/alert-dialog'
import type { DialogProps } from '@langgenius/dify-ui/dialog'
import type { ApiKeyDeleteTarget } from './api-key-table'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/console'
import { API_KEY_LIMIT, ApiKeyCreateAction, ApiKeyDialogContent } from './api-key-dialog-content'
import { ApiKeyTable } from './api-key-table'
import { CreatedApiKeyDialog } from './created-api-key-dialog'
import { DatasetScopeDialog } from './dataset-scope-dialog'
import { maskApiKey } from './mask-api-key'

type ApiKeyScope =
  | { type: 'app'; appId: string }
  | { type: 'dataset' }
  | { type: 'environment'; appId: string; environmentId: string }

type ApiKeyDialogProps = Required<Pick<DialogProps, 'open' | 'onOpenChange'>> & {
  canManage: boolean
  scope: ApiKeyScope
}

export function ApiKeyDialog({ open, canManage, scope, onOpenChange }: ApiKeyDialogProps) {
  const createAppApiKey = useMutation(consoleQuery.apps.byResourceId.apiKeys.post.mutationOptions())
  const deleteAppApiKey = useMutation(
    consoleQuery.apps.byResourceId.apiKeys.byApiKeyId.delete.mutationOptions(),
  )
  const createDatasetApiKey = useMutation(consoleQuery.datasets.apiKeys.post.mutationOptions())
  const deleteDatasetApiKey = useMutation(
    consoleQuery.datasets.apiKeys.byApiKeyId.delete.mutationOptions(),
  )
  const createEnvironmentApiKey = useMutation(
    consoleQuery.enterprise.appDeploy.accessService.createEnvironmentApiKey.mutationOptions(),
  )
  const deleteEnvironmentApiKey = useMutation(
    consoleQuery.enterprise.appDeploy.accessService.deleteEnvironmentApiKey.mutationOptions(),
  )

  const isCreating =
    scope.type === 'app'
      ? createAppApiKey.isPending
      : scope.type === 'dataset'
        ? createDatasetApiKey.isPending
        : createEnvironmentApiKey.isPending
  const deleteMutation =
    scope.type === 'app'
      ? deleteAppApiKey
      : scope.type === 'dataset'
        ? deleteDatasetApiKey
        : deleteEnvironmentApiKey
  const isPending = isCreating || deleteMutation.isPending
  const limit = scope.type === 'environment' ? undefined : API_KEY_LIMIT

  const createdKey =
    scope.type === 'app'
      ? createAppApiKey.data?.token
      : scope.type === 'dataset'
        ? createDatasetApiKey.data?.token
        : createEnvironmentApiKey.data?.token

  const createKey: ApiKeyDialogBodyProps['onCreate'] = (datasetIds, onSuccess) => {
    if (!canManage || isCreating) return
    switch (scope.type) {
      case 'app':
        createAppApiKey.mutate({ params: { resource_id: scope.appId } }, { onSuccess })
        break
      case 'dataset':
        createDatasetApiKey.mutate({ body: { dataset_ids: datasetIds } }, { onSuccess })
        break
      case 'environment':
        createEnvironmentApiKey.mutate(
          { params: { app_id: scope.appId, environment_id: scope.environmentId } },
          { onSuccess },
        )
        break
    }
  }

  const deleteKey: ApiKeyDialogBodyProps['onDelete'] = (keyId, onSuccess) => {
    if (!canManage || deleteMutation.isPending) return
    switch (scope.type) {
      case 'app':
        deleteAppApiKey.mutate(
          { params: { resource_id: scope.appId, api_key_id: keyId } },
          { onSuccess },
        )
        break
      case 'dataset':
        deleteDatasetApiKey.mutate({ params: { api_key_id: keyId } }, { onSuccess })
        break
      case 'environment':
        deleteEnvironmentApiKey.mutate(
          {
            params: { app_id: scope.appId, environment_id: scope.environmentId, api_key_id: keyId },
          },
          { onSuccess },
        )
        break
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && isPending) details.cancel()
        else onOpenChange(nextOpen, details)
      }}
    >
      <ApiKeyDialogContent
        closeDisabled={isPending}
        limit={limit}
        workspace={scope.type === 'dataset'}
      >
        <ApiKeyDialogBody
          scope={scope}
          canManage={canManage}
          isCreating={isCreating}
          isDeleting={deleteMutation.isPending}
          createdKey={createdKey}
          onCreate={createKey}
          onDelete={deleteKey}
        />
      </ApiKeyDialogContent>
    </Dialog>
  )
}

type ApiKeyDialogBodyProps = Pick<ApiKeyDialogProps, 'scope' | 'canManage'> & {
  isCreating: boolean
  isDeleting: boolean
  createdKey: string | undefined
  onCreate: (datasetIds: string[], onSuccess: () => void) => void
  onDelete: (keyId: string, onSuccess: () => void) => void
}

function ApiKeyDialogBody({
  scope,
  canManage,
  isCreating,
  isDeleting,
  createdKey,
  onCreate,
  onDelete,
}: ApiKeyDialogBodyProps) {
  const { t } = useTranslation(['appApi', 'common'])
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const deleteActionsRef = useRef<AlertDialogActions>(null)
  const deleteSucceededRef = useRef(false)
  const [createdDialogOpen, setCreatedDialogOpen] = useState(false)
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const limit = scope.type === 'environment' ? undefined : API_KEY_LIMIT
  const apiKeysQuery = useSuspenseQuery<
    AppApiKeyList | DatasetApiKeyList | ListEnvironmentApiKeysResponse
  >(
    scope.type === 'app'
      ? consoleQuery.apps.byResourceId.apiKeys.get.queryOptions({
          input: { params: { resource_id: scope.appId } },
        })
      : scope.type === 'dataset'
        ? consoleQuery.datasets.apiKeys.get.queryOptions()
        : consoleQuery.enterprise.appDeploy.accessService.listEnvironmentApiKeys.queryOptions({
            input: { params: { app_id: scope.appId, environment_id: scope.environmentId } },
          }),
  )

  const apiKeys = apiKeysQuery.data.data
  const createDisabled =
    !currentWorkspace.id ||
    !canManage ||
    !apiKeysQuery.isSuccess ||
    apiKeysQuery.isFetching ||
    (limit !== undefined && apiKeys.length >= limit)

  const handleCreate = () => {
    if (createDisabled || isCreating) return
    if (scope.type === 'dataset') setScopeDialogOpen(true)
    else onCreate([], () => setCreatedDialogOpen(true))
  }

  const handleCreateDatasetKey = (datasetIds: string[]) => {
    if (createDisabled || isCreating) return
    onCreate(datasetIds, () => {
      setCreatedDialogOpen(true)
      setScopeDialogOpen(false)
    })
  }

  const handleDelete = (keyId: string | undefined) => {
    if (!keyId || !canManage || isDeleting) return
    onDelete(keyId, () => {
      deleteSucceededRef.current = true
      deleteActionsRef.current?.close()
    })
  }

  return (
    <>
      <span role="status" className="sr-only">
        {isCreating || isDeleting || apiKeysQuery.isFetching
          ? t(($) => $.loading, { ns: 'common' })
          : ''}
      </span>
      {apiKeysQuery.isError && (
        <div className="flex items-center gap-2 px-6 py-4">
          <p role="status">{t(($) => $['api.actionFailed'], { ns: 'common' })}</p>
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              void apiKeysQuery.refetch()
            }}
          >
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
      <AlertDialog<ApiKeyDeleteTarget>
        actionsRef={deleteActionsRef}
        onOpenChange={(nextOpen, details) => {
          if (nextOpen) deleteSucceededRef.current = false
          if (!nextOpen && isDeleting && details.reason !== 'imperative-action') {
            details.cancel()
          }
        }}
      >
        {({ payload }) => (
          <>
            <ApiKeyTable
              apiKeys={apiKeys}
              canManage={canManage}
              showScope={scope.type === 'dataset'}
              allowCopy={scope.type === 'app'}
            />
            <AlertDialogContent
              backdropProps={{ forceRender: true }}
              finalFocus={() => (deleteSucceededRef.current ? createButtonRef.current : true)}
            >
              <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
                <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
                  {t(($) => $['actionMsg.deleteConfirmTitle'], { ns: 'appApi' })}
                </AlertDialogTitle>
                <AlertDialogDescription className="system-md-regular wrap-break-word text-text-tertiary">
                  <span className="mb-2 block font-mono" translate="no">
                    {payload && maskApiKey(payload.token)}
                  </span>
                  {t(($) => $['actionMsg.deleteConfirmTips'], { ns: 'appApi' })}
                </AlertDialogDescription>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancelButton disabled={isDeleting}>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton
                  loading={isDeleting}
                  disabled={!canManage}
                  onClick={() => handleDelete(payload?.id)}
                >
                  {t(($) => $['operation.delete'], { ns: 'common' })}
                </AlertDialogConfirmButton>
              </AlertDialogFooter>
            </AlertDialogContent>
          </>
        )}
      </AlertDialog>
      <ApiKeyCreateAction
        ref={createButtonRef}
        count={apiKeys.length}
        limit={limit}
        disabled={createDisabled}
        focusableWhenDisabled={canManage && !!currentWorkspace.id}
        loading={isCreating}
        onClick={handleCreate}
      />
      <CreatedApiKeyDialog
        open={createdDialogOpen}
        onOpenChange={setCreatedDialogOpen}
        value={createdKey}
        revealOnce={scope.type === 'dataset'}
        finalFocus={createButtonRef}
      />
      {scope.type === 'dataset' && (
        <DatasetScopeDialog
          open={scopeDialogOpen}
          isCreating={isCreating}
          createDisabled={createDisabled}
          finalFocus={() => (createdDialogOpen ? false : createButtonRef.current)}
          onOpenChange={setScopeDialogOpen}
          onConfirm={handleCreateDatasetKey}
        />
      )}
    </>
  )
}
