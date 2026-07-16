'use client'

import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DeleteAgentDialog } from '@/features/agent-v2/roster/components/delete-agent-dialog'
import { DuplicateAgentDialog } from '@/features/agent-v2/roster/components/duplicate-agent-dialog'
import { EditAgentDialog } from '@/features/agent-v2/roster/components/edit-agent-dialog'

type AgentDetailSidebarActionAgent = Pick<
  AgentAppPartial,
  | 'description'
  | 'icon'
  | 'icon_background'
  | 'icon_type'
  | 'icon_url'
  | 'id'
  | 'mode'
  | 'name'
  | 'role'
>

export function AgentDetailSidebarActions({ agent }: { agent: AgentDetailSidebarActionAgent }) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editSessionKey, setEditSessionKey] = useState(0)
  const [isDuplicateOpen, setIsDuplicateOpen] = useState(false)
  const [duplicateSessionKey, setDuplicateSessionKey] = useState(0)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const dialogAgent: AgentAppPartial = {
    description: agent.description,
    icon: agent.icon,
    icon_background: agent.icon_background,
    icon_type: agent.icon_type,
    icon_url: agent.icon_url,
    id: agent.id,
    mode: agent.mode,
    name: agent.name,
    role: agent.role,
  }

  const handleEditOpen = () => {
    setEditSessionKey((key) => key + 1)
    setIsEditOpen(true)
  }

  const handleDuplicateOpen = () => {
    setDuplicateSessionKey((key) => key + 1)
    setIsDuplicateOpen(true)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t(($) => $['roster.moreActions'], { name: agent.name })}
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-popup-open:bg-state-base-hover data-popup-open:text-text-secondary"
        >
          <span aria-hidden className="i-ri-more-fill size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-40">
          <DropdownMenuItem className="gap-2" onClick={handleEditOpen}>
            <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
            <span>{t(($) => $['roster.editInfo'])}</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" onClick={handleDuplicateOpen}>
            <span aria-hidden className="i-ri-file-copy-line size-4 shrink-0 text-text-tertiary" />
            <span>{tCommon(($) => $['operation.duplicate'])}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            className="gap-2"
            onClick={() => setIsDeleteOpen(true)}
          >
            <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
            <span>{tCommon(($) => $['operation.delete'])}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditAgentDialog
        agent={dialogAgent}
        formKey={editSessionKey}
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
      />
      <DuplicateAgentDialog
        agent={dialogAgent}
        formKey={duplicateSessionKey}
        open={isDuplicateOpen}
        onOpenChange={setIsDuplicateOpen}
      />
      <DeleteAgentDialog
        agentId={agent.id}
        agentName={agent.name}
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
      />
    </>
  )
}
