'use client'

import type { AgentCliTool } from '../types'
import { useTranslation } from 'react-i18next'

function CliIcon() {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-divider-regular bg-text-tertiary p-1 text-text-primary-on-surface">
      <span aria-hidden className="i-ri-terminal-box-line size-3.5" />
    </span>
  )
}

export function AgentCliToolItem({
  onDelete,
  onEdit,
  tool,
}: {
  onDelete: () => void
  onEdit: () => void
  tool: AgentCliTool
}) {
  const { t } = useTranslation('agentV2')

  return (
    <div className="group flex min-h-8 items-center gap-1 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg py-1.5 pr-1.5 pl-2 shadow-xs shadow-shadow-shadow-3 focus-within:border-components-panel-border focus-within:bg-components-panel-on-panel-item-bg-hover focus-within:shadow-sm hover:border-components-panel-border hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2 py-0.5 pr-1">
        <CliIcon />
        <span className="min-w-0 truncate system-sm-medium text-text-primary">
          {tool.name}
        </span>
      </div>
      <div className="hidden shrink-0 items-center gap-1 group-focus-within:flex group-hover:flex">
        <button
          type="button"
          aria-label={t('agentDetail.configure.tools.editAction', { name: tool.name })}
          onClick={onEdit}
          className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-equalizer-2-line size-4" />
        </button>
        <button
          type="button"
          aria-label={t('agentDetail.configure.tools.removeAction', { name: tool.name })}
          onClick={onDelete}
          className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        >
          <span aria-hidden className="i-ri-delete-bin-line size-4" />
        </button>
      </div>
      <span className="shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary group-focus-within:hidden group-hover:hidden">
        {t('agentDetail.configure.tools.cliTool')}
      </span>
    </div>
  )
}
