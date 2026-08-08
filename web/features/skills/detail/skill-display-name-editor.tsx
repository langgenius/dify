'use client'

import type { SkillDetailResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { SkillFileMutationCoordinator } from './shared'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { invalidateSkillDetail, runSkillFileMutation, setSkillDetailCache } from './shared'

export function SkillDisplayNameEditor({
  detail,
  editing,
  fileMutationCoordinator,
  onEditingChange,
  readonly,
  skillId,
}: {
  detail: SkillDetailResponse
  editing: boolean
  fileMutationCoordinator: SkillFileMutationCoordinator
  onEditingChange: (editing: boolean) => void
  readonly: boolean
  skillId: string
}) {
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const [displayNameOverride, setDisplayNameOverride] = useState<{
    base: string
    next: string
  }>()
  const [draftName, setDraftName] = useState(detail.display_name)
  const metadataMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.patch.mutationOptions({
      context: { silent: true },
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
      const nextDetail = await runSkillFileMutation(
        fileMutationCoordinator,
        async (expectedUpdatedAt) => {
          return metadataMutation.mutateAsync({
            params: {
              skill_id: skillId,
            },
            body: {
              display_name: nextDisplayName,
              expected_updated_at: expectedUpdatedAt,
            },
          })
        },
      )

      setSkillDetailCache(queryClient, skillId, nextDetail)
      invalidateSkillDetail(queryClient, skillId)
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
      })
      setDisplayNameOverride({
        base: detail.display_name,
        next: nextDisplayName,
      })
      setDraftName(nextDisplayName)
      onEditingChange(false)
      toast.success(t(($) => $['skillManagement.detail.renameSkillSuccess']))
    } catch {
      setDraftName(displayName)
      toast.error(t(($) => $['skillManagement.detail.saveFailed']))
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
      className="w-full cursor-text truncate rounded-md px-1 py-0.5 text-left system-md-semibold text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      onClick={() => {
        setDraftName(displayName)
        onEditingChange(true)
      }}
    >
      {displayName}
    </button>
  )
}
