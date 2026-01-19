import type { NodeProps } from 'reactflow'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { AssembleVariablesAlt } from '@/app/components/base/icons/src/vender/line/general'
import { Agent } from '@/app/components/base/icons/src/vender/workflow'
import Tooltip from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'
import { NodeSourceHandle } from '../../node-handle'

type SubGraphStartNodeData = CommonNodeType<{
  tooltip?: string
  iconType?: string
}>

type IconComponent = typeof Agent

const iconMap: Record<string, IconComponent> = {
  agent: Agent,
  assemble: AssembleVariablesAlt,
}

const SubGraphStartNode = ({ id, data }: NodeProps<SubGraphStartNodeData>) => {
  const { t } = useTranslation()
  const iconType = data?.iconType || 'agent'
  const Icon = iconMap[iconType] || Agent
  const rawTitle = data?.title?.trim() || ''
  const showTitle = iconType === 'agent' && !!rawTitle
  const displayTitle = showTitle && (rawTitle.startsWith('@') ? rawTitle : `@${rawTitle}`)
  const tooltip = data?.tooltip
    || (iconType === 'assemble' ? t('blocks.start', { ns: 'workflow' }) : (data?.title || t('blocks.start', { ns: 'workflow' })))

  return (
    <div
      className={cn(
        'nodrag group mt-1 flex h-11 items-center justify-center rounded-2xl border border-workflow-block-border bg-workflow-block-bg shadow-xs',
        showTitle ? 'gap-1.5 px-2' : 'w-11',
      )}
    >
      <Tooltip popupContent={tooltip} asChild={false}>
        <div className="flex h-6 w-6 items-center justify-center rounded-full border-[0.5px] border-components-panel-border-subtle bg-util-colors-blue-brand-blue-brand-500">
          <Icon className="h-3 w-3 text-text-primary-on-surface" />
        </div>
      </Tooltip>
      {showTitle && (
        <span className="system-xs-medium max-w-[160px] truncate text-text-secondary">
          {displayTitle}
        </span>
      )}
      <NodeSourceHandle
        id={id}
        data={data}
        handleClassName="!top-1/2 !-right-[9px] !-translate-y-1/2"
        handleId="source"
      />
    </div>
  )
}

export default memo(SubGraphStartNode)
