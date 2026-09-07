'use client'

import dynamic from '@/next/dynamic'

const TagManagementModal = dynamic(
  () =>
    import('@/features/tag-management/components/tag-management-modal').then(
      (mod) => mod.TagManagementModal,
    ),
  {
    ssr: false,
  },
)

export function AppListTagManagementModal({
  show,
  onClose,
}: {
  show: boolean
  onClose: () => void
}) {
  return <TagManagementModal type="app" show={show} onClose={onClose} />
}
