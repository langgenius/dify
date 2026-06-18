'use client'

import type { AgentCliTool } from '@/features/agent-v2/agent-composer/form-state'
import { useTranslation } from 'react-i18next'
import { ConfigureSectionConfigurableItem } from '../../common/configurable-item'

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
    <ConfigureSectionConfigurableItem
      icon={<CliIcon />}
      label={tool.name}
      badge={t('agentDetail.configure.tools.cliTool')}
      editAriaLabel={t('agentDetail.configure.tools.editAction', { name: tool.name })}
      removeAriaLabel={t('agentDetail.configure.tools.removeAction', { name: tool.name })}
      onEdit={onEdit}
      onRemove={onDelete}
    />
  )
}
