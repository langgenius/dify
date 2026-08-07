import type { AppPublisherProps } from './types'
import { useAtom, useAtomValue } from 'jotai'
import { useStore as useAppStore } from '@/app/components/app/store'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'
import { PublisherContent } from './publisher-content'
import { appPublisherOpenAtom, AppPublisherStateBoundary } from './state'

export function AppPublisher(props: AppPublisherProps) {
  const [open, setOpen] = useAtom(appPublisherOpenAtom)
  const appDetail = useAppStore((state) => state.appDetail)
  const currentUserId = useAtomValue(userProfileIdAtom)
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
