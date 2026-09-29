import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { currentWorkspaceAtom, currentWorkspaceLoadingAtom } from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { usePathname } from '@/next/navigation'
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
  const appDetail = useAppStore((state) => state.appDetail)
  const pathname = usePathname()
  const matched = /\/app\/([^/]+)/.exec(pathname)
  const appId = matched?.[1] || ''
  const serverLatestPublishedAt = useMemo(() => appDetail?.model_config?.updated_at, [appDetail])
  const appACLCapabilities = useMemo(
    () =>
      getAppACLCapabilities(appDetail?.permission_keys, {
        currentUserId,
        resourceMaintainer: appDetail?.maintainer,
        workspacePermissionKeys,
      }),
    [appDetail?.maintainer, appDetail?.permission_keys, currentUserId, workspacePermissionKeys],
  )
  const { mutateAsync: updateModelConfig } = useMutation(
    consoleQuery.apps.byAppId.modelConfig.post.mutationOptions({
      onSuccess: (_data, variables, _onMutateResult, context) =>
        context.client.invalidateQueries({
          queryKey: consoleQuery.apps.byAppId.get.queryKey({
            input: { params: { app_id: variables.params.app_id } },
          }),
        }),
    }),
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
