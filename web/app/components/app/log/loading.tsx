import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'

export function LogListSkeleton({ columns }: { columns: number }) {
  return (
    <tr aria-busy="true">
      <td colSpan={columns}>
        <SkeletonContainer className="gap-3">
          {Array.from({ length: 5 }, (_, index) => (
            <SkeletonRow key={index} className="h-12 gap-8 px-3">
              <SkeletonRectangle className="h-4 flex-1" />
              <SkeletonRectangle className="h-4 flex-1" />
              <SkeletonRectangle className="h-4 w-24" />
            </SkeletonRow>
          ))}
        </SkeletonContainer>
      </td>
    </tr>
  )
}

export function ConversationSkeleton() {
  return (
    <SkeletonContainer
      aria-busy="true"
      className="mx-1 mb-1 flex-1 gap-6 rounded-lg bg-background-section-burn p-4"
    >
      <SkeletonRectangle className="h-10 w-2/3 self-end rounded-xl" />
      <SkeletonContainer className="gap-3 rounded-xl bg-components-panel-bg p-4">
        <SkeletonRectangle className="h-4 w-1/3" />
        <SkeletonRectangle className="h-4 w-full" />
        <SkeletonRectangle className="h-4 w-4/5" />
        <SkeletonRectangle className="h-4 w-3/5" />
      </SkeletonContainer>
    </SkeletonContainer>
  )
}
