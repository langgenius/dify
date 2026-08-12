import type { AppPublisherProps } from './types'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtom, useAtomValue } from 'jotai'
import { useStore as useAppStore } from '@/app/components/app/store'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'
import { PublisherContent } from './publisher-content'
import { appPublisherOpenAtom, AppPublisherStateBoundary } from './state'

export function AppPublisher(props: AppPublisherProps) {
  const [open, setOpen] = useAtom(appPublisherOpenAtom)
  const appDetail = useAppStore((state) => state.appDetail)
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canDeploy = getAppACLCapabilities(appDetail?.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail?.maintainer,
    workspacePermissionKeys,
  }).canDeploy
  const supportsMultiEnvironment = appDetail?.mode === AppModeEnum.WORKFLOW && canDeploy

  return (
    <AppPublisherStateBoundary
      appId={appDetail?.id}
      environmentQueryEnabled={supportsMultiEnvironment}
    >
      <PublisherContent
        {...props}
        open={open}
        supportsMultiEnvironment={supportsMultiEnvironment}
        onOpenStateChange={setOpen}
      />
    </AppPublisherStateBoundary>
  )
}
