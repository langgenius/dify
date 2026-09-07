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

export function SkillListTagManagementModal({
  show,
  onClose,
  onTagsChange,
}: {
  show: boolean
  onClose: () => void
  onTagsChange: () => void
}) {
  return (
    <TagManagementModal type="skill" show={show} onClose={onClose} onTagsChange={onTagsChange} />
  )
}
