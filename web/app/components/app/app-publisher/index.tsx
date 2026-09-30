import type { AppPublisherProps } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { useSuspenseQueries } from '@tanstack/react-query'
import { useAtom, useAtomValue } from 'jotai'
import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/console'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'
import { PublisherContent } from './publisher-content'
import { appPublisherOpenAtom, AppPublisherStateBoundary } from './state'

export function AppPublisher(props: AppPublisherProps) {
  const { t } = useTranslation(['workflow'])
  return (
    <Suspense
      fallback={
        <Button variant="primary" className="py-2 pr-2 pl-3" disabled>
          {t(($) => $['common.publish'], { ns: 'workflow' })}
          <span className="i-ri-arrow-down-s-line size-4 text-components-button-primary-text" />
        </Button>
      }
    >
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
