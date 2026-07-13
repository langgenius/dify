'use client'
import type { TagType } from '@dify/contracts/api/console/tags/types.gen'
import { Dialog, DialogCloseButton, DialogContent } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { consoleQuery } from '@/service/client'
import { hasPermission } from '@/utils/permission'
import { getTagManagePermissionKey } from '../utils'
import { TagItemEditor } from './tag-item-editor'

type TagManagementModalProps = {
  type: TagType
  show: boolean
  onClose: () => void
  onTagsChange?: () => void
}
export const TagManagementModal = ({
  show,
  type,
  onClose,
  onTagsChange,
}: TagManagementModalProps) => {
  const { t } = useTranslation()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManageTags = hasPermission(workspacePermissionKeys, getTagManagePermissionKey(type))
  const { data: tagList = [] } = useQuery(
    consoleQuery.tags.get.queryOptions({
      input: {
        query: {
          type,
        },
      },
      enabled: show && canManageTags,
    }),
  )
  const createTagMutation = useMutation(consoleQuery.tags.post.mutationOptions())
  const [name, setName] = useState<string>('')

  const createNewTag = () => {
    if (!canManageTags) return
    if (!name) return
    if (createTagMutation.isPending) return

    createTagMutation.mutate(
      {
        body: {
          name,
          type,
        },
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['tag.created'], { ns: 'common' }))
          setName('')
        },
        onError: () => {
          toast.error(t(($) => $['tag.failed'], { ns: 'common' }))
        },
      },
    )
  }
  const handleClose = () => {
    setName('')
    onClose()
  }

  if (!canManageTags) return null

  return (
    <Dialog open={show} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="w-150 max-w-150 rounded-xl p-8">
        <div className="relative pb-2 text-xl/7.5 font-semibold text-text-primary">
          {t(($) => $['tag.manageTags'], { ns: 'common' })}
        </div>
        <DialogCloseButton className="top-4 right-4" />
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            aria-label={t(($) => $['tag.addNew'], { ns: 'common' }) || ''}
            className="w-25 shrink-0 appearance-none rounded-lg border border-dashed border-divider-regular bg-transparent px-2 py-1 text-sm/5 text-text-secondary caret-primary-600 outline-hidden placeholder:text-text-quaternary focus:border-solid"
            placeholder={t(($) => $['tag.addNew'], { ns: 'common' }) || ''}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && createNewTag()}
            onBlur={createNewTag}
          />
          {tagList.map((tag) => (
            <TagItemEditor key={tag.id} tag={tag} onTagsChange={onTagsChange} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
