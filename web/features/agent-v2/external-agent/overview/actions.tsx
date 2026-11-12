'use client'

import type { ExternalAgentOverview } from '../model'
import { Button } from '@langgenius/dify-ui/button'
import { Menu, MenuContent, MenuLinkItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import Link from '@/next/link'
import { ExternalAgentManageMenu } from '../manage-menu'
import { ExternalAgentTestPanel } from './test-run'

export function ExternalAgentOverviewActions({ overview }: { overview: ExternalAgentOverview }) {
  const { t } = useTranslation(['agentRoster', 'common', 'app'])
  const canManage = useAtomValue(isCurrentWorkspaceManagerAtom)
  const { agent } = overview

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ExternalAgentManageMenu agent={agent} />
      <ExternalAgentTestPanel overview={overview} />
      {canManage && (
        <Menu>
          <MenuTrigger render={<Button variant="primary" disabled={!agent.enabled} />}>
            <span aria-hidden className="i-ri-add-line size-4" />
            {t(($) => $['external.overview.createApp'])}
            <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
          </MenuTrigger>
          <MenuContent align="end" className="min-w-64">
            <MenuLinkItem render={<Link href="/apps?create=blank&mode=workflow" />}>
              <span
                aria-hidden
                className="i-ri-exchange-2-line size-4 shrink-0 text-text-primary"
              />
              <span className="px-1">{t(($) => $['types.workflow'], { ns: 'app' })}</span>
            </MenuLinkItem>
            <MenuLinkItem render={<Link href="/apps?create=blank&mode=advanced-chat" />}>
              <span aria-hidden className="i-ri-message-3-line size-4 shrink-0 text-text-primary" />
              <span className="px-1">{t(($) => $['types.advanced'], { ns: 'app' })}</span>
            </MenuLinkItem>
          </MenuContent>
        </Menu>
      )}
    </div>
  )
}
