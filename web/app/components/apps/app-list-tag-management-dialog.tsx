'use client'

import dynamic from 'next/dynamic'

const TagManagementDialog = dynamic(
  () =>
    import('@/features/tag-management/tag-management-dialog').then(
      (mod) => mod.TagManagementDialog,
    ),
  {
    ssr: false,
  },
)

export function AppListTagManagementDialog({
  show,
  onClose,
}: {
  show: boolean
  onClose: () => void
}) {
  return <TagManagementDialog type="app" show={show} onClose={onClose} />
}
