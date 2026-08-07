'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { createApikey as createAppApikey, delApikey as delAppApikey } from '@/service/apps'
import { consoleQuery } from '@/service/client'
import {
  createApikey as createDatasetApikey,
  delApikey as delDatasetApikey,
} from '@/service/datasets'
import { useDatasetApiKeys, useInvalidateDatasetApiKeys } from '@/service/knowledge/use-dataset'
import { useAppApiKeys, useInvalidateAppApiKeys } from '@/service/use-apps'
import { SecretKeyModalView } from './secret-key-modal-view'

export type SecretKeyScope =
  | { type: 'app'; appId: string }
  | { type: 'dataset' }
  | { type: 'environment'; appId: string; environmentId: string }

export type SecretKeyModalProps = {
  isShow: boolean
  canManage: boolean
  scope: SecretKeyScope
  onClose: () => void
}

type SecretKeyControllerProps = Omit<SecretKeyModalProps, 'scope'> & {
  createDisabled: boolean
}

export default function SecretKeyModal({
  isShow = false,
  canManage,
  scope,
  onClose,
}: SecretKeyModalProps) {
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const controllerProps = {
    canManage,
    createDisabled: !currentWorkspace.id || !canManage,
    isShow,
    onClose,
  }

  switch (scope.type) {
    case 'app':
      return <AppSecretKeyController {...controllerProps} appId={scope.appId} />
    case 'dataset':
      return <DatasetSecretKeyController {...controllerProps} />
    case 'environment':
      return (
        <EnvironmentSecretKeyController
          {...controllerProps}
          appId={scope.appId}
          environmentId={scope.environmentId}
        />
      )
  }
}

function AppSecretKeyController({
  appId,
  ...viewProps
}: SecretKeyControllerProps & { appId: string }) {
  const apiKeysQuery = useAppApiKeys(appId, { enabled: viewProps.isShow })
  const invalidateApiKeys = useInvalidateAppApiKeys()
  const createMutation = useMutation({
    mutationFn: () => createAppApikey({ url: `/apps/${appId}/api-keys`, body: {} }),
    onSuccess: () => invalidateApiKeys(appId),
  })
  const deleteMutation = useMutation({
    mutationFn: (keyId: string) =>
      delAppApikey({ url: `/apps/${appId}/api-keys/${keyId}`, params: {} }),
    onSuccess: () => invalidateApiKeys(appId),
  })

  return (
    <SecretKeyModalView
      {...viewProps}
      apiKeys={apiKeysQuery.data?.data}
      isCreating={createMutation.isPending}
      isDeleting={deleteMutation.isPending}
      isLoading={apiKeysQuery.isLoading}
      onCreate={(onSuccess) => createMutation.mutate(undefined, { onSuccess })}
      onDelete={(keyId, onSuccess) => deleteMutation.mutate(keyId, { onSuccess })}
    />
  )
}

function DatasetSecretKeyController(viewProps: SecretKeyControllerProps) {
  const apiKeysQuery = useDatasetApiKeys({ enabled: viewProps.isShow })
  const invalidateApiKeys = useInvalidateDatasetApiKeys()
  const createMutation = useMutation({
    mutationFn: () => createDatasetApikey({ url: '/datasets/api-keys', body: {} }),
    onSuccess: invalidateApiKeys,
  })
  const deleteMutation = useMutation({
    mutationFn: (keyId: string) =>
      delDatasetApikey({ url: `/datasets/api-keys/${keyId}`, params: {} }),
    onSuccess: invalidateApiKeys,
  })

  return (
    <SecretKeyModalView
      {...viewProps}
      apiKeys={apiKeysQuery.data?.data}
      isCreating={createMutation.isPending}
      isDeleting={deleteMutation.isPending}
      isLoading={apiKeysQuery.isLoading}
      onCreate={(onSuccess) => createMutation.mutate(undefined, { onSuccess })}
      onDelete={(keyId, onSuccess) => deleteMutation.mutate(keyId, { onSuccess })}
    />
  )
}

function EnvironmentSecretKeyController({
  appId,
  environmentId,
  ...viewProps
}: SecretKeyControllerProps & { appId: string; environmentId: string }) {
  const params = {
    app_id: appId,
    environment_id: environmentId,
  }
  const apiKeysQuery = useQuery(
    consoleQuery.enterprise.appDeploy.accessService.listEnvironmentApiKeys.queryOptions({
      input: { params },
      enabled: viewProps.isShow,
    }),
  )
  const createMutation = useMutation(
    consoleQuery.enterprise.appDeploy.accessService.createEnvironmentApiKey.mutationOptions(),
  )
  const deleteMutation = useMutation(
    consoleQuery.enterprise.appDeploy.accessService.deleteEnvironmentApiKey.mutationOptions(),
  )

  return (
    <SecretKeyModalView
      {...viewProps}
      apiKeys={apiKeysQuery.data?.data}
      isCreating={createMutation.isPending}
      isDeleting={deleteMutation.isPending}
      isLoading={apiKeysQuery.isLoading}
      onCreate={(onSuccess) => createMutation.mutate({ params }, { onSuccess })}
      onDelete={(keyId, onSuccess) =>
        deleteMutation.mutate(
          {
            params: {
              ...params,
              api_key_id: keyId,
            },
          },
          { onSuccess },
        )
      }
    />
  )
}
