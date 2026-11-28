'use client'

import type { AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentFormSource } from '@/features/agent-v2/roster/components/agent-form'
import {
  AlertDialog,
  AlertDialogContent,
  createAlertDialogHandle,
} from '@langgenius/dify-ui/alert-dialog'
import { createDialogHandle, Dialog } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useExportAppDsl } from '@/app/components/app/use-export-app-dsl'
import { toast } from '@/app/notifications'
import { getAgentACLCapabilities } from '@/features/agent-v2/acl'
import { DeleteAgentForm } from '@/features/agent-v2/delete-agent-form'
import { useCanCreateAgents } from '@/features/agent-v2/permissions'
import { DuplicateAgentDialogContent } from '@/features/agent-v2/roster/components/duplicate-agent-dialog'
import { EditAgentDialogContent } from '@/features/agent-v2/roster/components/edit-agent-dialog'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { useRequestErrorDescriber } from '@/service/use-request-error-message'

type AgentDetailSidebarActionAgent = AgentFormSource &
  Pick<AgentAppPartial, 'app_id' | 'permission_keys'>

export function AgentDetailSidebarActions({ agent }: { agent: AgentDetailSidebarActionAgent }) {
  const { t } = useTranslation(['agentRoster', 'agentV2'])
  const { t: tCommon } = useTranslation(['common'])
  const { t: tApp } = useTranslation(['app'])
  const describeRequestError = useRequestErrorDescriber()
  const [editDialog] = useState(() => createDialogHandle())
  const [duplicateDialog] = useState(() => createDialogHandle())
  const [deleteDialog] = useState(() => createAlertDialogHandle())
  const deletion = useMutation(
    consoleQuery.agent.byAgentId.delete.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const agentUpdate = useMutation(consoleQuery.agent.byAgentId.put.mutationOptions())
  const agentCopy = useMutation(consoleQuery.agent.byAgentId.copy.post.mutationOptions())
  const { exportAppDsl, isExporting } = useExportAppDsl()
  const router = useRouter()
  const capabilities = getAgentACLCapabilities(agent.permission_keys)
  const canDuplicate = useCanCreateAgents() && capabilities.canPreview
  const handleExport = () => {
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
      <Menu>
        <MenuTrigger
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
        <MenuContent align="end" className="w-max min-w-40">
          {capabilities.canEdit && (
            <MenuItem className="gap-2" onClick={() => editDialog.open(null)}>
              <span aria-hidden className="i-ri-edit-line size-4 shrink-0 text-text-tertiary" />
              <span>{t(($) => $['roster.editInfo'], { ns: 'agentRoster' })}</span>
            </MenuItem>
          )}
          {canDuplicate && (
            <MenuItem className="gap-2" onClick={() => duplicateDialog.open(null)}>
              <span
                aria-hidden
                className="i-ri-file-copy-line size-4 shrink-0 text-text-tertiary"
              />
              <span>{tCommon(($) => $['operation.duplicate'])}</span>
            </MenuItem>
          )}
          {capabilities.canImportExportDSL && (
            <MenuItem className="gap-2" disabled={isExporting} onClick={handleExport}>
              <span
                aria-hidden
                className="i-ri-file-download-line size-4 shrink-0 text-text-tertiary"
              />
              <span>{t(($) => $.exportAgent, { ns: 'agentV2' })}</span>
            </MenuItem>
          )}
          {capabilities.canDelete &&
            (capabilities.canEdit || canDuplicate || capabilities.canImportExportDSL) && (
              <MenuSeparator />
            )}
          {capabilities.canDelete && (
            <MenuItem
              variant="destructive"
              className="gap-2"
              onClick={() => deleteDialog.open(null)}
            >
              <span aria-hidden className="i-ri-delete-bin-line size-4 shrink-0" />
              <span>{tCommon(($) => $['operation.delete'])}</span>
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
      {capabilities.canEdit && (
        <Dialog
          handle={editDialog}
          disablePointerDismissal
          onOpenChange={(open, details) => {
            if (!open && agentUpdate.isPending && details.reason !== 'imperative-action')
              details.cancel()
          }}
          onOpenChangeComplete={(open) => {
            if (!open) agentUpdate.reset()
          }}
        >
          <EditAgentDialogContent
            agent={agent}
            pending={agentUpdate.isPending}
            onSubmit={(body) => {
              if (agentUpdate.isPending) return
              agentUpdate.mutate(
                { params: { agent_id: agent.id }, body },
                { onSuccess: () => editDialog.close() },
              )
            }}
          />
        </Dialog>
      )}
      {canDuplicate && (
        <Dialog
          handle={duplicateDialog}
          disablePointerDismissal
          onOpenChange={(open, details) => {
            if (!open && agentCopy.isPending && details.reason !== 'imperative-action')
              details.cancel()
          }}
          onOpenChangeComplete={(open) => {
            if (!open) agentCopy.reset()
          }}
        >
          <DuplicateAgentDialogContent
            agent={agent}
            pending={agentCopy.isPending}
            onSubmit={(body) => {
              if (agentCopy.isPending) return
              agentCopy.mutate(
                { params: { agent_id: agent.id }, body },
                { onSuccess: () => duplicateDialog.close() },
              )
            }}
          />
        </Dialog>
      )}
      {capabilities.canDelete && (
        <AlertDialog
          handle={deleteDialog}
          onOpenChange={(open, details) => {
            if (!open && deletion.isPending && details.reason !== 'imperative-action')
              details.cancel()
          }}
          onOpenChangeComplete={(open) => {
            if (!open) deletion.reset()
          }}
        >
          <AlertDialogContent>
            <DeleteAgentForm
              agentName={agent.name}
              isPending={deletion.isPending}
              error={
                deletion.isError
                  ? describeRequestError(
                      deletion.error,
                      t(($) => $['roster.deleteFailed']),
                    )
                  : undefined
              }
              onSubmit={() => {
                if (deletion.isPending) return
                deletion.mutate(
                  { params: { agent_id: agent.id } },
                  {
                    onSuccess: () => {
                      deleteDialog.close()
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
