'use client'

import { Select, SelectContent, SelectItem, SelectTrigger } from '@langgenius/dify-ui/select'
import { variableTransformer } from '@/app/components/workflow/utils/variable'

const AGENT_EVALUATION_VARIABLES = [
  { id: 'query', valueType: 'string' },
  { id: 'output', valueType: 'string' },
  { id: 'expected_output', valueType: 'string' },
  { id: 'tool_calls_json', valueType: 'string' },
  { id: 'expected_tool_calls_json', valueType: 'string' },
  { id: 'success_criteria_json', valueType: 'string' },
  { id: 'available_tools_json', valueType: 'string' },
  { id: 'trajectory_json', valueType: 'string' },
] as const

const AGENT_EVALUATION_SCOPE_ID = 'agent'

type AgentVariablePickerProps = {
  className?: string
  placeholder: string
  value: string | null
  onChange: (value: string | null) => void
}

const AgentVariablePicker = ({
  className,
  placeholder,
  value,
  onChange,
}: AgentVariablePickerProps) => {
  const selectedSelector = value ? variableTransformer(value) : []
  const selectedOutputVariableId = Array.isArray(selectedSelector)
    ? selectedSelector.join('.')
    : selectedSelector
  const selectedVariable = AGENT_EVALUATION_VARIABLES.find(
    (variable) => selectedOutputVariableId === `${AGENT_EVALUATION_SCOPE_ID}.${variable.id}`,
  )

  return (
    <Select<string>
      value={selectedVariable?.id}
      onValueChange={(variableId) => {
        if (variableId) onChange(`${AGENT_EVALUATION_SCOPE_ID}.${variableId}`)
      }}
    >
      <SelectTrigger className={className} aria-label={placeholder}>
        {selectedVariable ? (
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate system-xs-medium text-text-secondary">
              {selectedVariable.id}
            </span>
            <span className="shrink-0 system-xs-regular text-text-tertiary">
              {selectedVariable.valueType}
            </span>
          </div>
        ) : (
          <span className="system-sm-regular text-components-input-text-placeholder">
            {placeholder}
          </span>
        )}
      </SelectTrigger>
      <SelectContent>
        {AGENT_EVALUATION_VARIABLES.map((variable) => (
          <SelectItem key={variable.id} value={variable.id}>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate">{variable.id}</span>
              <span className="ml-auto shrink-0 system-xs-medium text-text-quaternary">
                {variable.valueType}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default AgentVariablePicker
