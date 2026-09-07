import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { currentWorkspaceAtom, currentWorkspaceLoadingAtom } from '@/context/workspace-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { usePathname } from '@/next/navigation'
import { updateAppModelConfig } from '@/service/apps'
import { consoleQuery } from '@/service/client'
import { getAppACLCapabilities } from '@/utils/permission'

export function useConfigurationAppContext() {
  const isLoadingCurrentWorkspace = useAtomValue(currentWorkspaceLoadingAtom)
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { appDetail, showAppConfigureFeaturesModal, setShowAppConfigureFeaturesModal } =
    useAppStore(
      useShallow((state) => ({
        appDetail: state.appDetail,
        showAppConfigureFeaturesModal: state.showAppConfigureFeaturesModal,
        setShowAppConfigureFeaturesModal: state.setShowAppConfigureFeaturesModal,
      })),
    )
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
  const { mutateAsync: updateModelConfig } = useMutation({
    mutationFn: (params: Parameters<typeof updateAppModelConfig>[0]) =>
      updateAppModelConfig(params),
    onSuccess: (_data, _variables, _onMutateResult, context) =>
      context.client.invalidateQueries({
        queryKey: consoleQuery.apps.byAppId.get.queryKey({
          input: { params: { app_id: appId } },
        }),
      }),
  })

  return {
    appACLCapabilities,
    appDetail,
    appId,
    configurationReadonly: !appACLCapabilities.canEdit,
    currentWorkspace,
    isLoadingCurrentWorkspace,
    serverLatestPublishedAt,
    setShowAppConfigureFeaturesModal,
    showAppConfigureFeaturesModal,
    updateModelConfig,
  }
}
