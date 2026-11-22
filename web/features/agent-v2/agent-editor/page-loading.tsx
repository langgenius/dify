'use client'

import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'

export function AgentConfigurePageLoading({ label }: { label: string }) {
  return (
    <section aria-label={label} aria-busy className="flex h-full min-w-0 flex-1 bg-background-body">
      <LoadingPlaceholder label={label} className="h-full" />
    </section>
  )
}
