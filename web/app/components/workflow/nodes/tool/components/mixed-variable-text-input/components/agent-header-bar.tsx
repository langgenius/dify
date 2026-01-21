import type { FC } from 'react'
import { RiCloseLine, RiEqualizer2Line } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { AssembleVariables } from '@/app/components/base/icons/src/vender/line/general'
import AlertTriangle from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback/AlertTriangle'
import { Agent } from '@/app/components/base/icons/src/vender/workflow'
import { cn } from '@/utils/classnames'

type AgentHeaderBarProps = {
  agentName: string
  onRemove: () => void
  onViewInternals?: () => void
  hasWarning?: boolean
  showAtPrefix?: boolean
}

const AgentHeaderBar: FC<AgentHeaderBarProps> = ({
  agentName,
  onRemove,
  onViewInternals,
  hasWarning,
  showAtPrefix = true,
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-between px-2 py-1">
      <div className="flex items-center gap-1">
        <div
          className={cn(
            'flex items-center gap-1 rounded-md border-[0.5px] px-1.5 py-0.5 shadow-xs',
            hasWarning
              ? 'border-text-warning-secondary bg-components-badge-status-light-warning-halo'
              : 'border-components-panel-border-subtle bg-components-badge-white-to-dark',
          )}
        >
          <div className={cn('flex h-4 w-4 items-center justify-center rounded', showAtPrefix
            ? 'bg-util-colors-indigo-indigo-500'
            : 'bg-util-colors-blue-blue-500')}
          >
            {showAtPrefix ? <Agent className="h-3 w-3 text-text-primary-on-surface" /> : <AssembleVariables className="h-3 w-3 text-text-primary-on-surface" />}
          </div>
          <span className="system-xs-medium text-text-secondary">
            {showAtPrefix && '@'}
            {agentName}
          </span>
          <button
            type="button"
            className="flex h-4 w-4 items-center justify-center rounded hover:bg-state-base-hover"
            onClick={onRemove}
          >
            <RiCloseLine className="h-3 w-3 text-text-tertiary" />
          </button>
        </div>
      </div>
      {onViewInternals && (
        <button
          type="button"
          className="flex items-center gap-1 text-text-tertiary hover:text-text-secondary"
          onClick={onViewInternals}
        >
          <RiEqualizer2Line className="h-3.5 w-3.5" />
          <span className="system-xs-medium">{t('common.viewInternals', { ns: 'workflow' })}</span>
          {hasWarning && (
            <AlertTriangle className="h-3.5 w-3.5 text-text-warning-secondary" />
          )}
        </button>
      )}
    </div>
  )
}

export default memo(AgentHeaderBar)
