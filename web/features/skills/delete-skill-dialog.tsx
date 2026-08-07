'use client'

import type { SkillResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { invalidateSkillListQueries } from './cache'
import { SkillReferencesList, SkillReferencesListSkeleton } from './detail/skill-metadata'

type DeleteSkillTarget = Pick<SkillResponse, 'display_name' | 'id' | 'name' | 'reference_count'>

export function DeleteSkillDialog({
  onDeleted,
  onOpenChange,
  open,
  skill,
}: {
  onDeleted?: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  skill: DeleteSkillTarget
}) {
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  const confirmationInputId = useId()
  const [confirmationInput, setConfirmationInput] = useState('')
  const queryClient = useQueryClient()
  const deleteMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.delete.mutationOptions(),
  )
  const referencesQuery = useQuery({
    ...consoleQuery.workspaces.current.skills.bySkillId.references.get.queryOptions({
      input: {
        params: {
          skill_id: skill.id,
        },
      },
    }),
    enabled: open,
    refetchOnMount: 'always',
  })
  const references = referencesQuery.data?.data ?? []
  const referenceCount = Math.max(skill.reference_count ?? 0, references.length)
  const isReferenced = referenceCount > 0
  const isDeleteDisabled =
    deleteMutation.isPending ||
    (open && !referencesQuery.isSuccess) ||
    (isReferenced && confirmationInput !== skill.display_name)
  const description = isReferenced
    ? t(($) => $['skillManagement.deleteDialog.referencedDescription'], {
        count: referenceCount,
      })
    : t(($) => $['skillManagement.deleteDialog.description'])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setConfirmationInput('')
    onOpenChange(nextOpen)
  }

  const handleDelete = () => {
    if (isDeleteDisabled) return

    deleteMutation.mutate(
      {
        params: {
          skill_id: skill.id,
        },
        body: {
          confirmation_name: isReferenced ? skill.display_name : undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['skillManagement.deleteSuccess']))
          invalidateSkillListQueries(queryClient)
          handleOpenChange(false)
          onDeleted?.()
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.deleteFailed']))
        },
      },
    )
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="p-6">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            handleDelete()
          }}
        >
          <AlertDialogTitle className="truncate title-2xl-semi-bold text-text-primary">
            {t(($) => $['skillManagement.deleteDialog.title'], { name: skill.display_name })}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-2 system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
            {description}
          </AlertDialogDescription>
          {isReferenced && (
            <>
              <div className="mt-4">
                {referencesQuery.isPending ? (
                  <SkillReferencesListSkeleton compact />
                ) : (
                  <SkillReferencesList
                    compact
                    maxHeight="max-h-[240px]"
                    references={references}
                    testId="skill-delete-reference-list"
                    visibleLimit={5}
                  />
                )}
              </div>
              <div className="mt-4">
                <label
                  htmlFor={confirmationInputId}
                  className="mb-1 block system-sm-regular text-text-secondary"
                >
                  <Trans
                    i18nKey={($) => $['skillManagement.deleteDialog.confirmInputLabel']}
                    ns="skill"
                    values={{ skillName: skill.display_name }}
                    components={{
                      skillName: (
                        <span className="system-sm-semibold text-text-primary" translate="no" />
                      ),
                    }}
                  />
                </label>
                <div className="relative">
                  <Input
                    id={confirmationInputId}
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t(
                      ($) => $['skillManagement.deleteDialog.confirmInputPlaceholder'],
                    )}
                    value={confirmationInput}
                    onChange={(event) => setConfirmationInput(event.target.value)}
                    className="pr-20"
                  />
                  <button
                    type="button"
                    onClick={() => setConfirmationInput(skill.display_name)}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/6 px-2.5 py-1 system-xs-medium text-text-secondary hover:bg-black/10"
                  >
                    {tCommon(($) => $['operation.fill'])}
                  </button>
                </div>
              </div>
            </>
          )}
          <AlertDialogActions className="p-0 pt-6">
            <AlertDialogCancelButton type="button" disabled={deleteMutation.isPending}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              type="submit"
              tone="destructive"
              loading={deleteMutation.isPending}
              disabled={isDeleteDisabled}
            >
              {isReferenced
                ? tCommon(($) => $['operation.confirm'])
                : tCommon(($) => $['operation.delete'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
