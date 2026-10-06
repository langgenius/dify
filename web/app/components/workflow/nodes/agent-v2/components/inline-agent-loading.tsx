import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'

export function InlineAgentLoading() {
  return (
    <div className="flex h-full min-h-80 items-center justify-center bg-components-panel-bg">
      <LoadingPlaceholder className="h-full" />
    </div>
  )
}
