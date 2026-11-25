'use client'

import type { ExternalAgentConfirmationRequest } from '../roster/components/external-agent-actions'
import type { ExternalAgentListItem } from '../roster/components/external-agent-list'
import { AlertDialog, createAlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { ExternalAgentConfirmationContent } from '../roster/components/external-agent-actions'

export function ExternalAgentManageMenu({
  agent,
  compact = false,
}: {
  agent: ExternalAgentListItem
  compact?: boolean
}) {
  const { t } = useTranslation(['agentRoster'])
  const canManage = useAtomValue(isCurrentWorkspaceManagerAtom)
  const router = useRouter()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [confirmation] = useState(() => createAlertDialogHandle<ExternalAgentConfirmationRequest>())
  const toggle = useMutation(
    consoleQuery.externalAgents.byAgentId.enabled.put.mutationOptions({
      context: { silent: true },
      retry: false,
    }),
  )
  const deletion = useMutation(
    consoleQuery.externalAgents.byAgentId.delete.mutationOptions({
      context: { silent: true },
      retry: false,
    }),
  )

  if (!canManage) return null

  const requestAction = (kind: ExternalAgentConfirmationRequest['kind']) => {
    confirmation.openWithPayload({
      kind,
      agent,
      trigger: triggerRef.current,
      adjacentFocusTargets: [],
    })
  }

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            compact ? (
              <IconButton ref={triggerRef} aria-label={t(($) => $['external.overview.manage'])}>
                <span aria-hidden className="i-ri-more-fill size-4" />
              </IconButton>
            ) : (
              <Button ref={triggerRef} variant="secondary" />
            )
          }
        >
          {compact ? (
            <span aria-hidden className="i-ri-more-fill size-4" />
          ) : (
            <>
              {t(($) => $['external.overview.manage'])}
              <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
            </>
          )}
        </MenuTrigger>
        <MenuContent align="end" className="w-57">
          <MenuItem className="px-3" onClick={() => requestAction('toggle')}>
            {agent.enabled ? t(($) => $['external.disable']) : t(($) => $['external.enable'])}
          </MenuItem>
          <MenuItem variant="destructive" className="px-3" onClick={() => requestAction('delete')}>
            {t(($) => $['external.delete'])}
          </MenuItem>
        </MenuContent>
      </Menu>
      <AlertDialog
        handle={confirmation}
        onOpenChange={(open, details) => {
          if (
            !open &&
            (toggle.isPending || deletion.isPending) &&
            details.reason !== 'imperative-action'
          )
            details.cancel()
        }}
        onOpenChangeComplete={(open) => {
          if (!open) {
            toggle.reset()
            deletion.reset()
          }
        }}
      >
        {({ payload }) =>
          payload && (
            <ExternalAgentConfirmationContent
              request={payload}
              pending={toggle.isPending || deletion.isPending}
              error={payload.kind === 'delete' ? deletion.error : toggle.error}
              fallbackFocus={triggerRef}
              onPauseInstead={() => confirmation.openWithPayload({ ...payload, kind: 'toggle' })}
              onConfirm={() => {
                if (payload.kind === 'delete')
                  deletion.mutate(
                    { params: { agent_id: payload.agent.key } },
                    {
                      onSuccess: () => {
                        confirmation.close()
                        router.replace('/agents?agent_type=external')
                      },
                    },
                  )
                else
                  toggle.mutate(
                    {
                      params: { agent_id: payload.agent.key },
                      body: { enabled: !payload.agent.enabled },
                    },
                    { onSuccess: () => confirmation.close() },
                  )
              }}
            />
          )
        }
      </AlertDialog>
    </>
  )
}
