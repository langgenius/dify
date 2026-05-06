import type { Tag } from '@/contract/console/tags'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@langgenius/dify-ui/tooltip'
import { useDebounceFn } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDeleteTagMutation, useUpdateTagMutation } from '../hooks/use-tag-mutations'

type TagItemEditorProps = {
  tag: Tag
  onTagsChange?: () => void
}
export const TagItemEditor = ({ tag, onTagsChange }: TagItemEditorProps) => {
  const { t } = useTranslation()
  const updateTagMutation = useUpdateTagMutation(tag.type)
  const deleteTagMutation = useDeleteTagMutation(tag.type)
  const [isEditing, setIsEditing] = useState(false)
  const [name, setName] = useState(tag.name)
  const editTag = (tagId: string, name: string) => {
    if (name === tag.name) {
      setIsEditing(false)
      return
    }
    if (!name) {
      toast.error('tag name is empty')
      setName(tag.name)
      setIsEditing(false)
      return
    }

    updateTagMutation.mutate({
      params: {
        tagId,
      },
      body: {
        name,
      },
    }, {
      onSuccess: () => {
        toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
        setName(name)
        setIsEditing(false)
        onTagsChange?.()
      },
      onError: () => {
        toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
        setName(tag.name)
        setIsEditing(false)
      },
    })
  }
  const [showRemoveModal, setShowRemoveModal] = useState(false)
  const removeTag = (tagId: string) => {
    if (deleteTagMutation.isPending)
      return

    deleteTagMutation.mutate({
      params: {
        tagId,
      },
    }, {
      onSuccess: () => {
        toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
        onTagsChange?.()
      },
      onError: () => {
        toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
      },
    })
  }
  const { run: handleRemove } = useDebounceFn(() => {
    removeTag(tag.id)
  }, { wait: 200 })
  return (
    <>
      <div className={cn('flex shrink-0 items-center gap-0.5 rounded-lg border border-components-panel-border py-1 pr-1 pl-2 text-sm leading-5 text-text-secondary')}>
        {!isEditing && (
          <>
            <div className="text-sm leading-5 text-text-secondary">
              {tag.name}
            </div>
            <Tooltip>
              <TooltipTrigger>
                <div className="shrink-0 px-1 text-sm leading-4.5 font-medium text-text-tertiary">{tag.binding_count}</div>
              </TooltipTrigger>
              <TooltipContent>{t('common.tagBound', { ns: 'workflow' })}</TooltipContent>
            </Tooltip>
            <div className="group/edit shrink-0 cursor-pointer rounded-md p-1 hover:bg-state-base-hover" onClick={() => setIsEditing(true)}>
              <span className="i-ri-edit-line h-3 w-3 text-text-tertiary group-hover/edit:text-text-secondary" data-testid="tag-item-editor-edit-button" />
            </div>
            <div
              className="group/remove shrink-0 cursor-pointer rounded-md p-1 hover:bg-state-base-hover"
              onClick={() => {
                if (tag.binding_count)
                  setShowRemoveModal(true)
                else
                  handleRemove()
              }}
            >
              <span className="i-ri-delete-bin-line h-3 w-3 text-text-tertiary group-hover/remove:text-text-secondary" data-testid="tag-item-editor-remove-button" />
            </div>
          </>
        )}
        {isEditing && (<input className="shrink-0 appearance-none caret-primary-600 outline-hidden placeholder:text-text-quaternary" autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && editTag(tag.id, name)} onBlur={() => editTag(tag.id, name)} />)}
      </div>
      <AlertDialog open={showRemoveModal} onOpenChange={open => !open && setShowRemoveModal(false)}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle
              title={`${t('tag.delete', { ns: 'common' })} "${tag.name}"`}
              className="w-full truncate title-2xl-semi-bold text-text-primary"
            >
              {`${t('tag.delete', { ns: 'common' })} "${tag.name}"`}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t('tag.deleteTip', { ns: 'common' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              onClick={() => {
                handleRemove()
                setShowRemoveModal(false)
              }}
            >
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
