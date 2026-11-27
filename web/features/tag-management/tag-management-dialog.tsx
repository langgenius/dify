'use client'
import type { TagType } from '@dify/contracts/api/console/tags/types.gen'
import { Button } from '@langgenius/dify-ui/button'
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
import { useOwnedQueryErrors } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
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
  const { t } = useTranslation(['common'])
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManageTags = hasPermission(workspacePermissionKeys, getTagManagePermissionKey(type))
  const tagsQuery = useQuery(
    consoleQuery.tags.get.queryOptions({
      input: {
        query: {
          type,
        },
      },
      enabled: show && canManageTags,
    }),
  )
  const tagList = tagsQuery.data ?? []
  // A failed load must not look like a workspace without tags. The closed dialog stays mounted, so
  // it claims the shared tag list's failure only while it shows it.
  const tagsLoad = useOwnedQueryErrors(show ? [tagsQuery] : [])
  const loadErrorMessage = useRequestErrorMessage(
    tagsLoad?.error,
    t(($) => $['dynamicSelect.error'], { ns: 'common' }),
  )
  const createTagMutation = useMutation(
    consoleQuery.tags.post.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  if (!canManageTags) return null

  return (
    <Dialog open={show} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-150">
        <DialogHeader>
          <DialogTitle>{t(($) => $['tag.manageTags'], { ns: 'common' })}</DialogTitle>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody className="flex flex-wrap gap-2">
          {tagsLoad && (
            <div role="alert" className="flex w-full items-center gap-2">
              <span className="min-w-0 flex-1 system-xs-regular text-text-tertiary">
                {loadErrorMessage}
              </span>
              <Button size="small" loading={tagsLoad.retrying} onClick={tagsLoad.retry}>
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            </div>
          )}
          <TagNameForm
            tags={tagList}
            label={t(($) => $['tag.addNew'])}
            inputClassName="w-25 max-w-full appearance-none rounded-lg border border-dashed border-divider-regular bg-transparent px-2 py-1 text-sm/5 text-text-secondary caret-primary-600 outline-hidden placeholder:text-text-quaternary focus:border-solid"
            pending={createTagMutation.isPending}
            onSave={(name) => createTagMutation.mutateAsync({ body: { name, type } })}
            onFinish={() => toast.success(t(($) => $['tag.created']))}
            onSaveError={(error) =>
              toast.error(getErrorMessage(error) ?? t(($) => $['tag.failed']))
            }
          />
          {tagList.map((tag) => (
            <TagItemEditor key={tag.id} tag={tag} tags={tagList} onTagsChange={onTagsChange} />
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
