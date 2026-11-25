'use client'
import type { TagType } from '@dify/contracts/api/console/tags/types.gen'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'
import { hasPermission } from '@/utils/permission'
import { getTagManagePermissionKey } from './permissions'
import { TagItemEditor } from './tag-item-editor'
import { TagNameForm } from './tag-name-form'

type TagManagementDialogProps = {
  type: TagType
  show: boolean
  onClose: () => void
  onTagsChange?: () => void
}
export const TagManagementDialog = ({
  show,
  type,
  onClose,
  onTagsChange,
}: TagManagementDialogProps) => {
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  if (!hasPermission(workspacePermissionKeys, getTagManagePermissionKey(type))) return null
  return (
    <Dialog open={show} onOpenChange={(open) => !open && onClose()}>
      <TagManagementDialogContent type={type} onTagsChange={onTagsChange} />
    </Dialog>
  )
}

export function TagManagementDialogContent({
  type,
  onTagsChange,
}: Pick<TagManagementDialogProps, 'type' | 'onTagsChange'>) {
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManageTags = hasPermission(workspacePermissionKeys, getTagManagePermissionKey(type))
  if (!canManageTags) return null
  return (
    <DialogContent className="w-150">
      <TagManagementSession type={type} onTagsChange={onTagsChange} />
    </DialogContent>
  )
}

function TagManagementSession({
  type,
  onTagsChange,
}: Pick<TagManagementDialogProps, 'type' | 'onTagsChange'>) {
  const { t } = useTranslation(['common'])
  const { data: tagList = [] } = useQuery(
    consoleQuery.tags.get.queryOptions({
      input: {
        query: {
          type,
        },
      },
    }),
  )
  const createTagMutation = useMutation(
    consoleQuery.tags.post.mutationOptions({ context: { silent: true } }),
  )
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(($) => $['tag.manageTags'], { ns: 'common' })}</DialogTitle>
        <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
      </DialogHeader>
      <DialogBody className="flex flex-wrap gap-2">
        <TagNameForm
          tags={tagList}
          label={t(($) => $['tag.addNew'])}
          inputClassName="w-25 max-w-full appearance-none rounded-lg border border-dashed border-divider-regular bg-transparent px-2 py-1 text-sm/5 text-text-secondary caret-primary-600 outline-hidden placeholder:text-text-quaternary focus:border-solid"
          pending={createTagMutation.isPending}
          onSave={(name) => createTagMutation.mutateAsync({ body: { name, type } })}
          onFinish={() => toast.success(t(($) => $['tag.created']))}
          onSaveError={(error) => toast.error(getErrorMessage(error) ?? t(($) => $['tag.failed']))}
        />
        {tagList.map((tag) => (
          <TagItemEditor key={tag.id} tag={tag} tags={tagList} onTagsChange={onTagsChange} />
        ))}
      </DialogBody>
    </>
  )
}
