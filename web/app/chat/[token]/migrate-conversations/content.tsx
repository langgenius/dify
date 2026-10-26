'use client'

import { useTranslation } from 'react-i18next'
import AppUnavailable from '@/app/components/base/app-unavailable'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'
import SignInConfirmation from '@/app/components/share/signin-confirmation'
import { getHttpErrorStatus } from '@/service/http-error'
import { useGetWebAppInfo } from '@/service/use-share'

export default function MigrateConversationsContent() {
  const { t } = useTranslation(['common'])
  const { data: appInfo, error } = useGetWebAppInfo()

  if (error) {
    const status = getHttpErrorStatus(error)
    return (
      <AppUnavailable className="size-auto" code={status ?? 500} isUnknownReason={status !== 404} />
    )
  }

  if (!appInfo) {
    return (
      <SkeletonContainer
        role="status"
        aria-label={t(($) => $.loading, { ns: 'common' })}
        className="w-full max-w-130 gap-6"
      >
        <SkeletonRectangle className="h-8 w-2/3" />
        <SkeletonRectangle className="h-20" />
        <SkeletonRectangle className="h-24" />
        <SkeletonRectangle className="h-9" />
      </SkeletonContainer>
    )
  }

  // Account and history remain preview data until the ownership API is available.
  return <SignInConfirmation email="evan@dify.ai" conversationCount={3} app={appInfo.site} />
}
