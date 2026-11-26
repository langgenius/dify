import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation } from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'
import { TagNameForm } from './tag-name-form'

type TagItemEditorProps = {
  tag: Tag
  tags: readonly Tag[]
  onTagsChange?: () => void
}
export const TagItemEditor = ({ tag, tags, onTagsChange }: TagItemEditorProps) => {
  const { t } = useTranslation(['common'])
  const updateTagMutation = useMutation(
    consoleQuery.tags.byTagId.patch.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const deleteTagMutation = useMutation(
    consoleQuery.tags.byTagId.delete.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const [isEditing, setIsEditing] = useState(false)
  const [showRemoveModal, setShowRemoveModal] = useState(false)
  const removeTag = (tagId: string) => {
    if (deleteTagMutation.isPending) return

    deleteTagMutation.mutate(
      {
        params: {
          tag_id: tagId,
        },
      },
      {
        onSuccess: () => {
          onTagsChange?.()
        },
        onError: (error) => {
          toast.error(
            getErrorMessage(error) ??
              t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
          )
        },
      },
    )
  }
  const { run: handleRemove } = useDebounceFn(
    () => {
      removeTag(tag.id)
    },
    { wait: 200 },
  )
  return (
    <>
      <div className="flex max-w-full items-center gap-0.5 rounded-lg border border-components-panel-border py-1 ps-2 pe-1 text-sm/5 text-text-secondary">
        {!isEditing && (
          <>
            <div className="min-w-0 wrap-anywhere">{tag.name}</div>
            <Tooltip>
              <TooltipTrigger>
                <div className="shrink-0 px-1 text-sm/4.5 font-medium text-text-tertiary">
                  {tag.binding_count}
                </div>
              </TooltipTrigger>
              <TooltipContent>{t(($) => $['tag.boundItems'], { ns: 'common' })}</TooltipContent>
            </Tooltip>
            <button
              type="button"
              aria-label={`${t(($) => $['operation.edit'], { ns: 'common' })} ${tag.name}`}
              className="group/edit shrink-0 cursor-pointer rounded-md border-none bg-transparent p-1 hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              onClick={() => setIsEditing(true)}
            >
              <span
                aria-hidden="true"
                className="i-ri-edit-line size-3 text-text-tertiary group-hover/edit:text-text-secondary"
              />
            </button>
            <button
              type="button"
              aria-label={`${t(($) => $['operation.remove'], { ns: 'common' })} ${tag.name}`}
              className="group/remove shrink-0 cursor-pointer rounded-md border-none bg-transparent p-1 hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              onClick={() => {
                if (Number(tag.binding_count ?? 0) > 0) setShowRemoveModal(true)
                else handleRemove()
              }}
            >
              <span
                aria-hidden="true"
                className="i-ri-delete-bin-line size-3 text-text-tertiary group-hover/remove:text-text-secondary"
              />
            </button>
          </>
        )}
        {isEditing && (
          <TagNameForm
            tag={tag}
            tags={tags}
            label={`${t(($) => $['operation.rename'])} ${tag.name}`}
            inputClassName="min-w-0 max-w-full appearance-none caret-primary-600 outline-hidden placeholder:text-text-quaternary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            pending={updateTagMutation.isPending}
            onSave={(name) =>
              updateTagMutation.mutateAsync(
                { params: { tag_id: tag.id }, body: { name } },
                { onSuccess: onTagsChange },
              )
            }
            onFinish={() => setIsEditing(false)}
            onSaveError={(error) => {
              toast.error(getErrorMessage(error) ?? t(($) => $['actionMsg.modifiedUnsuccessfully']))
              setIsEditing(false)
            }}
          />
        )}
      </div>
      <AlertDialog
        open={showRemoveModal}
        onOpenChange={(open) => !open && setShowRemoveModal(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {`${t(($) => $['tag.delete'], { ns: 'common' })} "${tag.name}"`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $['tag.deleteTip'], { ns: 'common' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              onClick={() => {
                handleRemove()
                setShowRemoveModal(false)
              }}
            >
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
