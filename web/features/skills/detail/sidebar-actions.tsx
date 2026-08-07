'use client'

import type { SkillDetailResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { downloadBlob } from '@/utils/download'
import { invalidateSkillListQueries } from '../cache'
import { fetchSkillArchiveBlob } from '../client'
import { DeleteSkillDialog } from '../delete-skill-dialog'

export function SkillDetailSidebarActions({
  detail,
  onRename,
}: {
  detail: SkillDetailResponse
  onRename: () => void
}) {
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const router = useRouter()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const duplicateMutation = useMutation(
    consoleQuery.workspaces.current.skills.bySkillId.duplicate.post.mutationOptions(),
  )
  const exportMutation = useMutation({
    mutationFn: () => fetchSkillArchiveBlob(detail.id),
    onSuccess: (blob) => {
      downloadBlob({ data: blob, fileName: `${detail.name}.zip` })
    },
    onError: () => {
      toast.error(tCommon(($) => $['operation.downloadFailed']))
    },
  })

  const handleDuplicate = () => {
    if (duplicateMutation.isPending) return

    duplicateMutation.mutate(
      {
        params: {
          skill_id: detail.id,
        },
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['skillManagement.duplicateSuccess']))
          invalidateSkillListQueries(queryClient)
        },
        onError: () => {
          toast.error(t(($) => $['skillManagement.duplicateFailed']))
        },
      },
    )
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          aria-label={t(($) => $['skillManagement.moreActions'], {
            name: detail.display_name,
          })}
          className="mt-px flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary"
        >
          <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-40">
          <DropdownMenuItem className="gap-2" onClick={onRename}>
            <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
            <span>{tCommon(($) => $['operation.rename'])}</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" onClick={handleDuplicate}>
            <span
              aria-hidden
              className="i-ri-file-copy-2-line size-4 shrink-0 text-text-tertiary"
            />
            <span>{tCommon(($) => $['operation.duplicate'])}</span>
          </DropdownMenuItem>
          {detail.latest_published_version_id && (
            <DropdownMenuItem
              className="gap-2"
              onClick={() => {
                if (!exportMutation.isPending) exportMutation.mutate()
              }}
            >
              <span
                aria-hidden
                className="i-ri-file-download-line size-4 shrink-0 text-text-tertiary"
              />
              <span>{tCommon(($) => $['operation.export'])}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            className="gap-2"
            onClick={() => setDeleteOpen(true)}
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
            <span>{tCommon(($) => $['operation.delete'])}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteSkillDialog
        skill={detail}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => router.push('/skills')}
      />
    </>
  )
}
