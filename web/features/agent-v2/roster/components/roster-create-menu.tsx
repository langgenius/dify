'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import CreateAppTemplateDialog from '@/app/components/app/create-app-dialog'
import { CreateAppMenu } from '@/app/components/app/create-app-menu'
import CreateFromDSLModal from '@/app/components/app/create-from-dsl-modal'
import { useCanCreateAgents, useCanImportAgents } from '@/features/agent-v2/permissions'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { CreateAgentDialog } from './create-agent-dialog'

export function RosterCreateMenu() {
  const queryClient = useQueryClient()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const canCreate = useCanCreateAgents()
  const canImport = useCanImportAgents()
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const canCreateFromTemplate = deploymentEdition === 'CLOUD' && canImport

  if (!canCreate && !canImport) return null

  return (
    <>
      <CreateAppMenu
        onCreateBlank={canCreate ? () => setCreateDialogOpen(true) : undefined}
        onImportDSL={canImport ? () => setImportDialogOpen(true) : undefined}
        onCreateTemplate={canCreateFromTemplate ? () => setTemplateDialogOpen(true) : undefined}
      />
      {canCreateFromTemplate && templateDialogOpen && (
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
