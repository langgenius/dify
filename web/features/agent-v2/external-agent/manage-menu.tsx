'use client'

import type { ExternalAgentActionRequest } from '../roster/components/external-agent-actions'
import type { ExternalAgentListItem } from '../roster/components/external-agent-list'
import { Button } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { useRouter } from '@/next/navigation'
import { ExternalAgentActions } from '../roster/components/external-agent-actions'

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
  const [request, setRequest] = useState<ExternalAgentActionRequest>()
  const [open, setOpen] = useState(false)

  if (!canManage) return null

  const requestAction = (kind: ExternalAgentActionRequest['kind']) => {
    setRequest({ kind, agent, trigger: triggerRef.current, adjacentFocusTargets: [] })
    setOpen(true)
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
      <ExternalAgentActions
        request={request}
        open={open}
        onOpenChange={setOpen}
        onRequest={setRequest}
        fallbackFocus={triggerRef}
        onDeleted={() => router.push('/agents?agent_type=external')}
      />
    </>
  )
}
