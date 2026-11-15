import type { Locale } from '@/i18n'
import { Suspense } from 'react'
import AppAccessConfigPage from '@/app/components/app/access-config'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'

export type AccessConfigPageProps = {
  params: Promise<{ locale: Locale; appId: string }>
}

const AccessConfig = async (props: AccessConfigPageProps) => {
  const params = await props.params

  const { appId } = params

  return (
    <Suspense
      fallback={
        <SkeletonContainer className="gap-4 p-6" aria-busy="true">
          <SkeletonRectangle className="h-6 w-48" />
          <SkeletonRectangle className="h-16 w-full" />
          <SkeletonRectangle className="h-64 w-full" />
        </SkeletonContainer>
      }
    >
      <AppAccessConfigPage appId={appId} />
    </Suspense>
  )
}

export default AccessConfig
