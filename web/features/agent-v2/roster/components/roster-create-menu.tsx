'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { CreateAppDropdown } from '@/app/components/app/create-app-dropdown'
import CreateFromDSLModal from '@/app/components/app/create-from-dsl-modal'
import { consoleQuery } from '@/service/client'
import { CreateAgentDialog } from './create-agent-dialog'

export function RosterCreateMenu() {
  const queryClient = useQueryClient()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)

  return (
    <>
      <CreateAppDropdown
        onCreateBlank={() => setCreateDialogOpen(true)}
        onImportDSL={() => setImportDialogOpen(true)}
      />
      <CreateAgentDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
      {importDialogOpen && (
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
