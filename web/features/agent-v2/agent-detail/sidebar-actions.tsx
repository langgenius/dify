'use client'

import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentFormSource } from '@/features/agent-v2/roster/components/agent-form'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useExportAppDsl } from '@/app/components/app/use-export-app-dsl'
import { getAgentACLCapabilities } from '@/features/agent-v2/acl'
import { useCanCreateAgents } from '@/features/agent-v2/permissions'
import { DeleteAgentDialog } from '@/features/agent-v2/roster/components/delete-agent-dialog'
import { DuplicateAgentDialog } from '@/features/agent-v2/roster/components/duplicate-agent-dialog'
import { EditAgentDialog } from '@/features/agent-v2/roster/components/edit-agent-dialog'
import { useRouter } from '@/next/navigation'

type AgentDetailSidebarActionAgent = AgentFormSource &
  Pick<AgentAppPartial, 'app_id' | 'permission_keys'>

export function AgentDetailSidebarActions({ agent }: { agent: AgentDetailSidebarActionAgent }) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const { t: tApp } = useTranslation('app')
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDuplicateOpen, setIsDuplicateOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
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
          aria-label={t(($) => $['roster.moreActions'], { name: agent.name })}
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary"
        >
          <span aria-hidden className="i-ri-more-fill size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-40">
          {capabilities.canEdit && (
            <DropdownMenuItem className="gap-2" onClick={handleEditOpen}>
              <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
              <span>{t(($) => $['roster.editInfo'])}</span>
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
              <span>{tApp(($) => $.export)}</span>
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
        <DeleteAgentDialog
          agentId={agent.id}
          agentName={agent.name}
          open={isDeleteOpen}
          onOpenChange={setIsDeleteOpen}
          onDeleted={() => router.replace('/agents')}
        />
      )}
    </>
  )
}
