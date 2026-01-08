import type { FC } from 'react'
import { RiCloseLine, RiEqualizer2Line } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Agent } from '@/app/components/base/icons/src/vender/workflow'

type AgentHeaderBarProps = {
  agentName: string
  onRemove: () => void
  onViewInternals?: () => void
}

const AgentHeaderBar: FC<AgentHeaderBarProps> = ({
  agentName,
  onRemove,
  onViewInternals,
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-between px-2 py-1">
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-1 rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark px-1.5 py-0.5 shadow-xs">
          <div className="flex h-4 w-4 items-center justify-center rounded bg-util-colors-indigo-indigo-500">
            <Agent className="h-3 w-3 text-text-primary-on-surface" />
          </div>
          <span className="system-xs-medium text-text-secondary">
            @
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
      <button
        type="button"
        className="flex items-center gap-0.5 text-text-tertiary hover:text-text-secondary"
        onClick={onViewInternals}
      >
        <RiEqualizer2Line className="h-3.5 w-3.5" />
        <span className="system-xs-medium">{t('common.viewInternals', { ns: 'workflow' })}</span>
      </button>
    </div>
  )
}

export default memo(AgentHeaderBar)
