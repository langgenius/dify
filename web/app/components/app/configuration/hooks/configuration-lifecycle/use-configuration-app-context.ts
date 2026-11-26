import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { currentWorkspaceAtom, currentWorkspaceLoadingAtom } from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { getAppACLCapabilities } from '@/utils/permission'

export function useConfigurationAppContext() {
  const isLoadingCurrentWorkspace = useAtomValue(currentWorkspaceLoadingAtom)
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { appId } = useParams<{ appId: string }>()
  const { data: appDetail } = useSuspenseQuery(
    consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: appId } } }),
  )
  const serverLatestPublishedAt = appDetail.model_config?.updated_at
  const appACLCapabilities = useMemo(
    () =>
      getAppACLCapabilities(appDetail.permission_keys, {
        currentUserId,
        resourceMaintainer: appDetail.maintainer,
        workspacePermissionKeys,
      }),
    [appDetail.maintainer, appDetail.permission_keys, currentUserId, workspacePermissionKeys],
  )
  const { mutateAsync: updateModelConfig } = useMutation(
    consoleQuery.apps.byAppId.modelConfig.post.mutationOptions(),
  )

  return {
    appACLCapabilities,
    appDetail,
    appId,
    configurationReadonly: !appACLCapabilities.canEdit,
    currentWorkspace,
    isLoadingCurrentWorkspace,
    serverLatestPublishedAt,
    updateModelConfig,
  }
}
