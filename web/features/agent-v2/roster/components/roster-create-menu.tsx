'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CreateAppDropdown } from '@/app/components/app/create-app-dropdown'
import CreateFromDSLModal from '@/app/components/app/create-from-dsl-modal'
import { consoleQuery } from '@/service/client'
import { ConnectExternalAgentDialog } from './connect-external-agent-dialog'
import { CreateAgentDialog } from './create-agent-dialog'

export function RosterCreateMenu() {
  const queryClient = useQueryClient()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [connectExternalDialogOpen, setConnectExternalDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const { t } = useTranslation('agentV2')

  return (
    <>
      <CreateAppDropdown
        additionalPrimaryActions={[
          {
            key: 'connect-external-agent',
            iconClassName: 'i-ri-link-m',
            label: t(($) => $['externalAgent.connectMenu']),
            onSelect: () => setConnectExternalDialogOpen(true),
          },
        ]}
        onCreateBlank={() => setCreateDialogOpen(true)}
        onImportDSL={() => setImportDialogOpen(true)}
      />
      <CreateAgentDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
      <ConnectExternalAgentDialog
        open={connectExternalDialogOpen}
        onOpenChange={setConnectExternalDialogOpen}
      />
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
