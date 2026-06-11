'use client'

import type { AgentConfigSnapshotDetailResponse } from '@dify/contracts/api/console/agents/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { isAgentConfigureDirtyAtom, useAgentConfigurePublishPayload } from '../atoms'

type AgentConfigurePublishBarProps = {
  agentId: string
  agentSoulConfig?: AgentConfigSnapshotDetailResponse['config_snapshot']
  currentModel?: {
    provider: string
    model: string
  }
  onOpenVersions: () => void
}

export function AgentConfigurePublishBar({
  agentId,
  agentSoulConfig,
  currentModel,
  onOpenVersions,
}: AgentConfigurePublishBarProps) {
  const { t } = useTranslation('agentV2')
  const isDirty = useAtomValue(isAgentConfigureDirtyAtom)
  const publishPayload = useAgentConfigurePublishPayload({
    agentId,
    baseConfig: agentSoulConfig,
    currentModel,
  })

  const handlePublish = () => {
    // eslint-disable-next-line no-console -- Requested temporary publish payload inspection.
    console.log('[Agent Roster] publish payload', publishPayload)
  }

  return (
    <div className="flex h-14 shrink-0 items-center justify-end border-t border-divider-subtle px-4">
      <div className="flex min-w-0 items-center gap-3 rounded-xl border border-divider-subtle bg-components-panel-bg px-4 py-2 shadow-lg shadow-shadow-shadow-5">
        <div className="flex min-w-0 items-center gap-2 system-sm-regular text-text-tertiary">
          <span aria-hidden className="size-1.5 shrink-0 rounded-[2px] bg-text-tertiary" />
          <span className="shrink-0 text-text-secondary">{t('agentDetail.configure.publishBar.draft')}</span>
          <span aria-hidden className="shrink-0">·</span>
          <span className="min-w-0 truncate">
            {isDirty
              ? t('agentDetail.configure.publishBar.unsaved')
              : t('agentDetail.configure.publishBar.saved')}
          </span>
        </div>
        <button
          type="button"
          aria-label={t('agentDetail.configure.publishBar.versionHistory')}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          onClick={onOpenVersions}
        >
          <span aria-hidden className="i-ri-history-line size-4" />
        </button>
        <Button
          type="button"
          variant="primary"
          className="h-8 gap-2 rounded-lg px-3"
          onClick={handlePublish}
        >
          <span>{t('agentDetail.publish')}</span>
          <span aria-hidden className="flex items-center gap-0.5">
            <span className="flex size-4 items-center justify-center rounded-[4px] bg-components-button-primary-bg-hover system-2xs-medium text-text-primary-on-surface">⌘</span>
            <span className="flex size-4 items-center justify-center rounded-[4px] bg-components-button-primary-bg-hover system-2xs-medium text-text-primary-on-surface">⇧</span>
            <span className="flex size-4 items-center justify-center rounded-[4px] bg-components-button-primary-bg-hover system-2xs-medium text-text-primary-on-surface">P</span>
          </span>
        </Button>
      </div>
    </div>
  )
}
