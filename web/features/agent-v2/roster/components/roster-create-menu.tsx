'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import CreateAppTemplateDialog from '@/app/components/app/create-app-dialog'
import { CreateAppDropdown } from '@/app/components/app/create-app-dropdown'
import CreateFromDSLModal from '@/app/components/app/create-from-dsl-modal'
import { useCanCreateAgents, useCanImportAgents } from '@/features/agent-v2/permissions'
import { consoleQuery } from '@/service/console'
import { CreateAgentDialog } from './create-agent-dialog'

export function RosterCreateMenu() {
  const queryClient = useQueryClient()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const canCreate = useCanCreateAgents()
  const canImport = useCanImportAgents()

  if (!canCreate && !canImport) return null

  return (
    <>
      <CreateAppDropdown
        onCreateBlank={canCreate ? () => setCreateDialogOpen(true) : undefined}
        onImportDSL={canImport ? () => setImportDialogOpen(true) : undefined}
        onCreateTemplate={canImport ? () => setTemplateDialogOpen(true) : undefined}
      />
      {canImport && templateDialogOpen && (
        <CreateAppTemplateDialog
          show
          templateMode="agent"
          onClose={() => setTemplateDialogOpen(false)}
        />
      )}
      {canCreate && (
        <CreateAgentDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
      )}
      {canImport && importDialogOpen && (
        <CreateFromDSLModal
          show
          onClose={() => setImportDialogOpen(false)}
          onSuccess={() => {
            void queryClient.invalidateQueries({ queryKey: consoleQuery.agent.get.key() })
          }}
        />
      )}
    </>
  )
}
