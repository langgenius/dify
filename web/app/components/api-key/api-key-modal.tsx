'use client'
import type { ApiKeyItem } from '@dify/contracts/api/console/apps/types.gen'
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/client'
import { ApiKeyTable } from './api-key-table'
import { CreatedApiKeyDialog } from './created-api-key-dialog'

type CreatedApiKey = Pick<ApiKeyItem, 'token'>
type ApiKeyScope =
  | { type: 'app'; appId: string }
  | { type: 'dataset' }
  | { type: 'environment'; appId: string; environmentId: string }

type ApiKeyModalProps = {
  open: boolean
  canManage: boolean
  scope: ApiKeyScope
  onOpenChange: (open: boolean) => void
}

export function ApiKeyModal({ open, canManage, scope, onOpenChange }: ApiKeyModalProps) {
  const { t } = useTranslation()
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const [deleteKeyId, setDeleteKeyId] = useState<string>()
  const [createdApiKey, setCreatedApiKey] = useState<CreatedApiKey>()

  const appApiKeysQuery = useQuery(
    consoleQuery.apps.byResourceId.apiKeys.get.queryOptions({
      input: open && scope.type === 'app' ? { params: { resource_id: scope.appId } } : skipToken,
    }),
  )
  const datasetApiKeysQuery = useQuery({
    ...consoleQuery.datasets.apiKeys.get.queryOptions(),
    enabled: open && scope.type === 'dataset',
  })
  const environmentApiKeysQuery = useQuery(
    consoleQuery.enterprise.appDeploy.accessService.listEnvironmentApiKeys.queryOptions({
      input:
        open && scope.type === 'environment'
          ? { params: { app_id: scope.appId, environment_id: scope.environmentId } }
          : skipToken,
    }),
  )

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

  const apiKeys =
    scope.type === 'app'
      ? appApiKeysQuery.data?.data
      : scope.type === 'dataset'
        ? datasetApiKeysQuery.data?.data
        : environmentApiKeysQuery.data?.data
  const isLoading =
    scope.type === 'app'
      ? appApiKeysQuery.isLoading
      : scope.type === 'dataset'
        ? datasetApiKeysQuery.isLoading
        : environmentApiKeysQuery.isLoading
  const isCreating =
    scope.type === 'app'
      ? createAppApiKey.isPending
      : scope.type === 'dataset'
        ? createDatasetApiKey.isPending
        : createEnvironmentApiKey.isPending
  const isDeleting =
    scope.type === 'app'
      ? deleteAppApiKey.isPending
      : scope.type === 'dataset'
        ? deleteDatasetApiKey.isPending
        : deleteEnvironmentApiKey.isPending
  const createDisabled = !currentWorkspace.id || !canManage

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setDeleteKeyId(undefined)
      setCreatedApiKey(undefined)
    }
    onOpenChange(nextOpen)
  }

  const handleCreate = () => {
    if (createDisabled || isCreating) return

    switch (scope.type) {
      case 'app':
        createAppApiKey.mutate(
          { params: { resource_id: scope.appId } },
          { onSuccess: setCreatedApiKey },
        )
        break
      case 'dataset':
        createDatasetApiKey.mutate(undefined, { onSuccess: setCreatedApiKey })
        break
      case 'environment':
        createEnvironmentApiKey.mutate(
          { params: { app_id: scope.appId, environment_id: scope.environmentId } },
          { onSuccess: setCreatedApiKey },
        )
        break
    }
  }

  const handleDelete = () => {
    if (!deleteKeyId || isDeleting) return

    const onSuccess = () => setDeleteKeyId(undefined)
    switch (scope.type) {
      case 'app':
        deleteAppApiKey.mutate(
          { params: { resource_id: scope.appId, api_key_id: deleteKeyId } },
          { onSuccess },
        )
        break
      case 'dataset':
        deleteDatasetApiKey.mutate({ params: { api_key_id: deleteKeyId } }, { onSuccess })
        break
      case 'environment':
        deleteEnvironmentApiKey.mutate(
          {
            params: {
              app_id: scope.appId,
              environment_id: scope.environmentId,
              api_key_id: deleteKeyId,
            },
          },
          { onSuccess },
        )
        break
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex w-200 flex-col overflow-hidden p-0">
          <div className="flex shrink-0 flex-col gap-1 px-6 pt-6 pr-14 pb-4">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['apiKeyModal.apiSecretKey'], { ns: 'appApi' })}
            </DialogTitle>
            <DialogDescription className="system-sm-regular text-text-tertiary">
              {t(($) => $['apiKeyModal.apiSecretKeyTips'], { ns: 'appApi' })}
            </DialogDescription>
          </div>
          <DialogClose
            render={
              <IconButton
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                size="lg"
                className="absolute inset-e-6 top-6"
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            }
          />
          {isLoading && (
            <div className="flex min-h-24 items-center border-y border-divider-subtle px-6">
              <Loading />
            </div>
          )}
          {!!apiKeys?.length && (
            <ApiKeyTable apiKeys={apiKeys} canManage={canManage} onDeleteRequest={setDeleteKeyId} />
          )}
          <div className="flex shrink-0 px-6 py-4">
            <Button disabled={createDisabled} loading={isCreating} onClick={handleCreate}>
              <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
              {t(($) => $['apiKeyModal.createNewSecretKey'], { ns: 'appApi' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={deleteKeyId !== undefined}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteKeyId(undefined)
        }}
      >
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
            <AlertDialogCancelButton disabled={isDeleting}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton loading={isDeleting} onClick={handleDelete}>
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
      <CreatedApiKeyDialog
        open={open && createdApiKey !== undefined}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setCreatedApiKey(undefined)
        }}
        value={createdApiKey?.token ?? ''}
      />
    </>
  )
}
