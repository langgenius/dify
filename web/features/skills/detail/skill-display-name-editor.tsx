'use client'

import type { SkillDetailResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { SkillFileMutationCoordinator } from './shared'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { fetchSkillFileBlob } from '../client'
import {
  findFileByPath,
  invalidateSkillDetail,
  runSkillFileMutation,
  setMarkdownDisplayName,
  setSkillDetailCache,
} from './shared'

export function SkillDisplayNameEditor({
  detail,
  fileMutationCoordinator,
  readonly,
  skillId,
}: {
  detail: SkillDetailResponse
  fileMutationCoordinator: SkillFileMutationCoordinator
  readonly: boolean
  skillId: string
}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [displayNameOverride, setDisplayNameOverride] = useState<{
    base: string
    next: string
  }>()
  const [draftName, setDraftName] = useState(detail.display_name)
  const fileMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.files.patch.mutationOptions({
      context: { silent: true },
    }),
  )
  const metadataMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.patch.mutationOptions({
      context: { silent: true },
    }),
  )
  const saving = fileMutation.isPending || metadataMutation.isPending
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
    setEditing(false)
  }

  const saveDisplayName = async () => {
    const nextDisplayName = draftName.trim()
    if (saving) return
    if (!nextDisplayName || nextDisplayName === displayName) {
      cancelEditing()
      return
    }

    const skillFile = findFileByPath(detail.files ?? [], 'SKILL.md')
    if (!skillFile) {
      toast.error(t(($) => $['skillManagement.detail.fileMissing']))
      return
    }

    try {
      const currentContent =
        skillFile.content ??
        (await (
          await fetchSkillFileBlob({
            path: skillFile.path,
            skillId,
            versionId: null,
          })
        ).text())
      const nextContent = setMarkdownDisplayName(currentContent, nextDisplayName)
      const nextDetail = await runSkillFileMutation(
        fileMutationCoordinator,
        async (expectedUpdatedAt) => {
          const fileDetail = await fileMutation.mutateAsync({
            params: {
              skill_id: skillId,
            },
            body: {
              content: nextContent,
              expected_updated_at: expectedUpdatedAt,
              hash: skillFile.hash,
              mime_type: skillFile.mime_type,
              operation: 'upsert_text',
              path: skillFile.path,
              size: new Blob([nextContent]).size,
            },
          })
          const metadataDetail = await metadataMutation.mutateAsync({
            params: {
              skill_id: skillId,
            },
            body: {
              display_name: nextDisplayName,
              expected_updated_at: fileDetail.updated_at,
            },
          })

          return {
            ...fileDetail,
            ...metadataDetail,
            files: fileDetail.files,
          }
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
      setEditing(false)
    } catch {
      setDraftName(displayName)
      toast.error(t(($) => $['skillManagement.detail.saveFailed']))
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
        setEditing(true)
      }}
    >
      {displayName}
    </button>
  )
}
