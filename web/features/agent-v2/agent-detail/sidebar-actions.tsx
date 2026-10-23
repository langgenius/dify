'use client'

import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentFormSource } from '@/features/agent-v2/roster/components/agent-form'
import { AlertDialog, AlertDialogContent } from '@langgenius/dify-ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useExportAppDsl } from '@/app/components/app/use-export-app-dsl'
import { toast } from '@/app/notifications'
import { getAgentACLCapabilities } from '@/features/agent-v2/acl'
import { DeleteAgentForm } from '@/features/agent-v2/delete-agent-form'
import { useCanCreateAgents } from '@/features/agent-v2/permissions'
import { DuplicateAgentDialog } from '@/features/agent-v2/roster/components/duplicate-agent-dialog'
import { EditAgentDialog } from '@/features/agent-v2/roster/components/edit-agent-dialog'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'

type AgentDetailSidebarActionAgent = AgentFormSource &
  Pick<AgentAppPartial, 'app_id' | 'permission_keys'>

export function AgentDetailSidebarActions({ agent }: { agent: AgentDetailSidebarActionAgent }) {
  const { t } = useTranslation(['agentRoster', 'agentV2'])
  const { t: tCommon } = useTranslation(['common'])
  const { t: tApp } = useTranslation(['app'])
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDuplicateOpen, setIsDuplicateOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const deletion = useMutation(
    consoleQuery.agent.byAgentId.delete.mutationOptions({ context: { silent: true } }),
  )
  const { exportAppDsl, isExporting } = useExportAppDsl()
  const router = useRouter()
  const capabilities = getAgentACLCapabilities(agent.permission_keys)
  const canDuplicate = useCanCreateAgents() && capabilities.canPreview
  const handleEditOpen = () => {
    setIsEditOpen(true)
  }

  const handleDuplicateOpen = () => {
    setIsDuplicateOpen(true)
  }

  const handleExport = () => {
    if (!capabilities.canImportExportDSL) return
    if (!agent.app_id) {
      toast.error(tApp(($) => $.exportFailed))
      return
    }

    return exportAppDsl({
      format: 'ifpkg',
      appId: agent.app_id,
      appName: agent.name,
    })
  }

  if (
    !capabilities.canEdit &&
    !canDuplicate &&
    !capabilities.canImportExportDSL &&
    !capabilities.canDelete
  )
    return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton
              aria-label={t(($) => $['roster.moreActions'], {
                ns: 'agentRoster',
                name: agent.name,
              })}
              size="md"
              className="data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary"
            >
              <span aria-hidden className="i-ri-more-fill size-4" />
            </IconButton>
          }
        />
        <DropdownMenuContent className="w-max min-w-40">
          {capabilities.canEdit && (
            <DropdownMenuItem className="gap-2" onClick={handleEditOpen}>
              <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
              <span>{t(($) => $['roster.editInfo'], { ns: 'agentRoster' })}</span>
            </DropdownMenuItem>
          )}
          {canDuplicate && (
            <DropdownMenuItem className="gap-2" onClick={handleDuplicateOpen}>
              <span
                aria-hidden
                className="i-ri-file-copy-line size-4 shrink-0 text-text-tertiary"
              />
              <span>{tCommon(($) => $['operation.duplicate'])}</span>
            </DropdownMenuItem>
          )}
          {capabilities.canImportExportDSL && (
            <DropdownMenuItem className="gap-2" disabled={isExporting} onClick={handleExport}>
              <span
                aria-hidden
                className="i-ri-file-download-line size-4 shrink-0 text-text-tertiary"
              />
              <span>{t(($) => $.exportAgent, { ns: 'agentV2' })}</span>
            </DropdownMenuItem>
          )}
          {capabilities.canDelete &&
            (capabilities.canEdit || canDuplicate || capabilities.canImportExportDSL) && (
              <DropdownMenuSeparator />
            )}
          {capabilities.canDelete && (
            <DropdownMenuItem
              variant="destructive"
              className="gap-2"
              onClick={() => setIsDeleteOpen(true)}
            >
              <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
              <span>{tCommon(($) => $['operation.delete'])}</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {capabilities.canEdit && (
        <EditAgentDialog agent={agent} open={isEditOpen} onOpenChange={setIsEditOpen} />
      )}
      {canDuplicate && (
        <DuplicateAgentDialog
          agent={agent}
          open={isDuplicateOpen}
          onOpenChange={setIsDuplicateOpen}
        />
      )}
      {capabilities.canDelete && (
        <AlertDialog
          open={isDeleteOpen}
          onOpenChange={(open, details) => {
            if (!open && deletion.isPending) details.cancel()
            else setIsDeleteOpen(open)
          }}
          onOpenChangeComplete={(open) => {
            if (!open) deletion.reset()
          }}
        >
          <AlertDialogContent>
            <DeleteAgentForm
              agentName={agent.name}
              isPending={deletion.isPending}
              error={deletion.isError ? t(($) => $['roster.deleteFailed']) : undefined}
              onSubmit={() => {
                if (deletion.isPending) return
                deletion.mutate(
                  { params: { agent_id: agent.id } },
                  {
                    onSuccess: () => {
                      setIsDeleteOpen(false)
                      router.replace('/agents')
                    },
                  },
                )
              }}
            />
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )
}
