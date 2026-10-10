'use client'

import type {
  ConversationVariable,
  Edge,
  EnvironmentVariable,
  Node,
} from '@/app/components/workflow/types'
import { useTranslation } from 'react-i18next'
import AgentVariablePicker from './agent-variable-picker'
import PublishedGraphVariablePicker from './published-graph-variable-picker'

type MappingSource =
  | {
      type: 'agent'
    }
  | {
      type: 'workflow'
      publishedGraph: {
        nodes: Node[]
        edges: Edge[]
        environmentVariables: EnvironmentVariable[]
        conversationVariables: ConversationVariable[]
      }
    }

type MappingRowProps = {
  inputVariable: {
    id: string
    valueType: string
  }
  source: MappingSource
  value: string | null
  onUpdate: (outputVariableId: string | null) => void
}

const MappingRow = ({ inputVariable, source, value, onUpdate }: MappingRowProps) => {
  const { t } = useTranslation('evaluation')

  return (
    <div className="flex items-center">
      <div className="flex h-8 w-[200px] items-center rounded-md px-2">
        <div className="flex min-w-0 items-center gap-0.5 px-1">
          <span
            aria-hidden="true"
            className="i-custom-vender-solid-development-variable-02 h-3.5 w-3.5 shrink-0 text-text-accent"
          />
          <div className="truncate system-xs-medium text-text-secondary">{inputVariable.id}</div>
          <div className="shrink-0 system-xs-regular text-text-tertiary">
            {inputVariable.valueType}
          </div>
        </div>
      </div>

      <div className="flex h-8 w-9 items-center justify-center px-3 system-xs-medium text-text-tertiary">
        <span aria-hidden="true">→</span>
      </div>

      {source.type === 'agent' ? (
        <AgentVariablePicker
          className="grow"
          value={value}
          placeholder={t(($) => $['metrics.custom.outputPlaceholder'])}
          onChange={onUpdate}
        />
      ) : (
        <PublishedGraphVariablePicker
          className="grow"
          nodes={source.publishedGraph.nodes}
          edges={source.publishedGraph.edges}
          environmentVariables={source.publishedGraph.environmentVariables}
          conversationVariables={source.publishedGraph.conversationVariables}
          value={value}
          placeholder={t(($) => $['metrics.custom.outputPlaceholder'])}
          onChange={onUpdate}
        />
      )}
    </div>
  )
}

export default MappingRow
