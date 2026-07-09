'use client'

import Loading from '@/app/components/base/loading'

export function AgentConfigurePageLoading({
  label,
}: {
  label: string
}) {
  return (
    <section
      aria-label={label}
      aria-busy
      className="flex h-full min-w-0 flex-1 bg-background-body"
    >
      <Loading type="app" />
    </section>
  )
}
