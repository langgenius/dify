import { cn } from '@langgenius/dify-ui/cn'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { getQueryClient } from '@/app/get-query-client'
import { systemFeaturesServerQueryOptions } from '@/features/system-features/server'
import Header from '../signin/_header'

export default async function InstallLayout({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient()
  await queryClient.prefetchQuery(systemFeaturesServerQueryOptions())
  const systemFeatures = queryClient.getQueryData<{ branding: { enabled: boolean } }>(
    systemFeaturesServerQueryOptions().queryKey,
  )
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className={cn('flex min-h-screen w-full justify-center bg-background-default-burn p-6')}>
        <div
          className={cn(
            'flex w-full shrink-0 flex-col rounded-2xl border border-effects-highlight bg-background-default-subtle',
          )}
        >
          <Header />
          {children}
          {!systemFeatures?.branding?.enabled && (
            <div className="px-8 py-6 text-sm font-normal text-text-tertiary">
              © {new Date().getFullYear()} LangGenius, Inc. All rights reserved.
            </div>
          )}
        </div>
      </div>
    </HydrationBoundary>
  )
}
