import type { FC } from 'react'
import type { Variable } from '@/app/components/workflow/types'
import * as React from 'react'

type OutputVariablesContentProps = {
  variables?: Variable[]
}

// Define the display order for variable labels to match the table order in the UI
const LABEL_ORDER = { raw: 0, param: 1, header: 2, body: 3 } as const

const getLabelPrefix = (label: string): string => {
  const prefixMap: Record<string, string> = {
    raw: 'payload',
    param: 'query_params',
    header: 'header_params',
    body: 'req_body_params',
  }
  return prefixMap[label] || label
}

type VarItemProps = {
  prefix: string
  name: string
  type: string
}

const VarItem: FC<VarItemProps> = ({ prefix, name, type }) => {
  return (
    <div className="py-1">
      <div className="flex items-center leading-[18px]">
        <span className="code-sm-regular text-text-tertiary">
          {prefix}
          .
        </span>
        <span className="code-sm-semibold text-text-secondary">{name}</span>
        <span className="system-xs-regular ml-2 text-text-tertiary">{type}</span>
      </div>
    </div>
  )
}

export const OutputVariablesContent: FC<OutputVariablesContentProps> = ({ variables = [] }) => {
  if (!variables || variables.length === 0) {
    return (
      <div className="system-sm-regular py-2 text-text-tertiary">
        No output variables
      </div>
    )
  }

  // Sort variables by label to match the table display order: param → header → body
  // Unknown labels are placed at the end (order value 999)
  const sortedVariables = [...variables].sort((a, b) => {
    const labelA = typeof a.label === 'string' ? a.label : ''
    const labelB = typeof b.label === 'string' ? b.label : ''
    return (LABEL_ORDER[labelA as keyof typeof LABEL_ORDER] || 999)
      - (LABEL_ORDER[labelB as keyof typeof LABEL_ORDER] || 999)
  })

  return (
    <div>
      {sortedVariables.map((variable, index) => {
        const label = typeof variable.label === 'string' ? variable.label : ''
        const varName = typeof variable.variable === 'string' ? variable.variable : ''

        return (
          <VarItem
            key={`${label}-${varName}-${index}`}
            prefix={getLabelPrefix(label)}
            name={varName}
            type={variable.value_type || 'string'}
          />
        )
      })}
    </div>
  )
}
