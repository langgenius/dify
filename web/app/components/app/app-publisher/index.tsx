import type { AppPublisherProps } from './types'
import { useSuspenseQueries } from '@tanstack/react-query'
import { useAtom, useAtomValue } from 'jotai'
import { Suspense } from 'react'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/console'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'
import { PublisherContent } from './publisher-content'
import { appPublisherOpenAtom, AppPublisherStateBoundary } from './state'

export function AppPublisher(props: AppPublisherProps) {
  return (
    <Suspense fallback={<SkeletonRectangle className="h-8 w-20" />}>
      <AppPublisherContent {...props} />
    </Suspense>
  )
}

function AppPublisherContent(props: AppPublisherProps) {
  const [open, setOpen] = useAtom(appPublisherOpenAtom)
  const { appId } = props
  const [{ data: appDetail }, { data: profile }] = useSuspenseQueries({
    queries: [
      consoleQuery.apps.byAppId.get.queryOptions({ input: { params: { app_id: appId } } }),
      userProfileQueryOptions(),
    ],
  })
  const currentUserId = profile.profile.id
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { canDeploy, canViewAccessPoint } = getAppACLCapabilities(appDetail.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail.maintainer,
    workspacePermissionKeys,
  })
  const supportsMultiEnvironment =
    (appDetail.mode === AppModeEnum.WORKFLOW || appDetail.mode === AppModeEnum.ADVANCED_CHAT) &&
    canDeploy

  return (
    <AppPublisherStateBoundary
      appId={appDetail.id}
      environmentQueryEnabled={supportsMultiEnvironment}
    >
      <PublisherContent
        {...props}
        appDetail={appDetail}
        canViewAccessPoint={canViewAccessPoint}
        open={open}
        supportsMultiEnvironment={supportsMultiEnvironment}
        onOpenStateChange={setOpen}
      />
    </AppPublisherStateBoundary>
  )
}
