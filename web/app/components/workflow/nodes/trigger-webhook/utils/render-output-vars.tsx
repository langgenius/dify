import type { FC } from 'react'
import React from 'react'
import type { Variable } from '@/app/components/workflow/types'

type OutputVariablesContentProps = {
  variables?: Variable[]
}

const getLabelPrefix = (label: string): string => {
  const prefixMap: Record<string, string> = {
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
    <div className='py-1'>
      <div className='flex items-center leading-[18px]'>
        <span className='code-sm-regular text-text-tertiary'>{prefix}.</span>
        <span className='code-sm-semibold text-text-secondary'>{name}</span>
        <span className='system-xs-regular ml-2 text-text-tertiary'>{type}</span>
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

  return (
    <div>
      {variables.map((variable, index) => {
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
