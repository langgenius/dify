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
  onTagsChange,
}: {
  show: boolean
  onClose: () => void
  onTagsChange: () => unknown
}) {
  return <TagManagementModal type="app" show={show} onClose={onClose} onTagsChange={onTagsChange} />
}
