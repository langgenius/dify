'use client'

import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/client'
import { SecretKeyModalView } from './view'

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
  const apiKeysQuery = useQuery(
    consoleQuery.apps.byResourceId.apiKeys.get.queryOptions({
      input: viewProps.isShow ? { params: { resource_id: appId } } : skipToken,
    }),
  )
  const createMutation = useMutation(consoleQuery.apps.byResourceId.apiKeys.post.mutationOptions())
  const deleteMutation = useMutation(
    consoleQuery.apps.byResourceId.apiKeys.byApiKeyId.delete.mutationOptions(),
  )

  return (
    <SecretKeyModalView
      {...viewProps}
      apiKeys={apiKeysQuery.data?.data}
      isCreating={createMutation.isPending}
      isDeleting={deleteMutation.isPending}
      isLoading={apiKeysQuery.isLoading}
      onCreate={(onSuccess) =>
        createMutation.mutate({ params: { resource_id: appId } }, { onSuccess })
      }
      onDelete={(keyId, onSuccess) =>
        deleteMutation.mutate({ params: { resource_id: appId, api_key_id: keyId } }, { onSuccess })
      }
    />
  )
}

function DatasetSecretKeyController(viewProps: SecretKeyControllerProps) {
  const apiKeysQuery = useQuery({
    ...consoleQuery.datasets.apiKeys.get.queryOptions(),
    enabled: viewProps.isShow,
  })
  const createMutation = useMutation(consoleQuery.datasets.apiKeys.post.mutationOptions())
  const deleteMutation = useMutation(
    consoleQuery.datasets.apiKeys.byApiKeyId.delete.mutationOptions(),
  )

  return (
    <SecretKeyModalView
      {...viewProps}
      apiKeys={apiKeysQuery.data?.data}
      isCreating={createMutation.isPending}
      isDeleting={deleteMutation.isPending}
      isLoading={apiKeysQuery.isLoading}
      onCreate={(onSuccess) => createMutation.mutate(undefined, { onSuccess })}
      onDelete={(keyId, onSuccess) =>
        deleteMutation.mutate({ params: { api_key_id: keyId } }, { onSuccess })
      }
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
