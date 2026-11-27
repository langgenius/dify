'use client'

import type { SkillDetailResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { SkillDraftMutationCoordinator } from './mutations'
import { useMutation } from '@tanstack/react-query'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { useRequestErrorDescriber } from '@/service/use-request-error-message'
import { getSkillErrorCode, getSkillErrorDetailString } from '../error'
import { runSkillDraftMutation } from './mutations'

export function SkillDisplayNameEditor({
  detail,
  editing,
  draftMutationCoordinator,
  onEditingChange,
  readonly,
  skillId,
}: {
  detail: SkillDetailResponse
  editing: boolean
  draftMutationCoordinator: SkillDraftMutationCoordinator
  onEditingChange: (editing: boolean) => void
  readonly: boolean
  skillId: string
}) {
  const { t } = useTranslation(['skill'])
  const { t: tCommon } = useTranslation(['common'])
  const describeRequestError = useRequestErrorDescriber()
  const inputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const [displayNameOverride, setDisplayNameOverride] = useState<{
    base: string
    next: string
  }>()
  const [draftName, setDraftName] = useState(detail.display_name)
  const metadataMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.patch.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const saving = metadataMutation.isPending
  const displayName =
    displayNameOverride?.base === detail.display_name
      ? displayNameOverride.next
      : detail.display_name

  useLayoutEffect(() => {
    if (!editing) return

    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const cancelEditing = () => {
    if (saving) return
    setDraftName(displayName)
    onEditingChange(false)
  }

  const saveDisplayName = async () => {
    const nextDisplayName = draftName.trim()
    if (saving || submittingRef.current) return
    if (!nextDisplayName || nextDisplayName === displayName) {
      cancelEditing()
      return
    }

    submittingRef.current = true
    try {
      await runSkillDraftMutation(draftMutationCoordinator, async (expectedUpdatedAt) => {
        return metadataMutation.mutateAsync({
          params: {
            skill_id: skillId,
          },
          body: {
            display_name: nextDisplayName,
            expected_updated_at: expectedUpdatedAt,
          },
        })
      })

      setDisplayNameOverride({
        base: detail.display_name,
        next: nextDisplayName,
      })
      setDraftName(nextDisplayName)
      onEditingChange(false)
    } catch (error) {
      setDraftName(displayName)

      if (getSkillErrorCode(error) === 'skill_name_conflict') {
        toast.error(
          t(($) => $['skillManagement.errors.nameConflict'], {
            name: getSkillErrorDetailString(error, 'name') ?? '',
          }),
        )
      } else {
        toast.error(
          describeRequestError(
            error,
            t(($) => $['skillManagement.detail.saveFailed']),
          ),
        )
      }
    } finally {
      submittingRef.current = false
    }
  }

  if (readonly) {
    return (
      <div className="w-full truncate rounded-md px-1 py-0.5 system-md-semibold text-text-secondary">
        {displayName}
      </div>
    )
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label={tCommon(($) => $['operation.rename'])}
        value={draftName}
        disabled={saving}
        className="h-6 w-full rounded-md border border-components-input-border-active bg-components-input-bg-active px-1 py-0.5 system-md-semibold text-text-secondary caret-primary-600 shadow-xs outline-hidden focus:ring-0 disabled:cursor-wait"
        onBlur={() => {
          if (draftName.trim()) void saveDisplayName()
          else cancelEditing()
        }}
        onChange={(event) => setDraftName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void saveDisplayName()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            cancelEditing()
          }
        }}
      />
    )
  }

  return (
    <button
      type="button"
      aria-label={tCommon(($) => $['operation.rename'])}
      className="w-full cursor-text truncate rounded-md px-1 py-0.5 text-start system-md-semibold text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      onClick={() => {
        setDraftName(displayName)
        onEditingChange(true)
      }}
    >
      {displayName}
    </button>
  )
}
