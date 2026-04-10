import type { FC } from 'react'
import type { NodeProps } from '../../types'
import type { AgentV2NodeType } from './types'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RiRobot2Line, RiToolsFill } from '@remixicon/react'
import { Group, GroupLabel } from '../_base/components/group'
import { SettingItem } from '../_base/components/setting-item'

const strategyLabels: Record<string, string> = {
  auto: 'Auto',
  'function-calling': 'Function Calling',
  'chain-of-thought': 'ReAct (Chain of Thought)',
}

const AgentV2Node: FC<NodeProps<AgentV2NodeType>> = ({ id, data }) => {
  const { t } = useTranslation()

  const modelName = data.model?.name || ''
  const modelProvider = data.model?.provider || ''
  const strategy = data.agent_strategy || 'auto'
  const enabledTools = useMemo(() => (data.tools || []).filter(t => t.enabled), [data.tools])
  const maxIter = data.max_iterations || 10

  return (
    <div className="mb-1 space-y-1 px-3">
      <SettingItem label={t('workflow.nodes.llm.model')}>
        <span className="system-xs-medium text-text-secondary truncate">
          {modelName || 'Not configured'}
        </span>
      </SettingItem>
      <SettingItem label="Strategy">
        <span className="system-xs-medium text-text-secondary">
          {strategyLabels[strategy] || strategy}
        </span>
      </SettingItem>
      {enabledTools.length > 0 && (
        <Group label={<GroupLabel className="mt-1"><RiToolsFill className="mr-1 inline h-3 w-3" />Tools ({enabledTools.length})</GroupLabel>}>
          <div className="flex flex-wrap gap-1">
            {enabledTools.slice(0, 6).map((tool, i) => (
              <span key={i} className="inline-flex items-center rounded bg-components-badge-bg-gray px-1.5 py-0.5 text-[11px] text-text-tertiary">
                {tool.tool_name}
              </span>
            ))}
            {enabledTools.length > 6 && (
              <span className="text-[11px] text-text-quaternary">+{enabledTools.length - 6}</span>
            )}
          </div>
        </Group>
      )}
      {maxIter !== 10 && (
        <SettingItem label="Max Iterations">
          <span className="system-xs-medium text-text-secondary">{maxIter}</span>
        </SettingItem>
      )}
    </div>
  )
}

AgentV2Node.displayName = 'AgentV2Node'
export default memo(AgentV2Node)
