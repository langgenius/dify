import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import InputVarTypeIcon from '../_base/components/input-var-type-icon'
import type { StartNodeType } from './types'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import type { NodeProps } from '@/app/components/workflow/types'
const i18nPrefix = 'workflow.nodes.start'

const Node: FC<NodeProps<StartNodeType>> = ({
  data,
}) => {
  const { t } = useTranslation()
  const { variables } = data

  if (!variables.length)
    return null

  return (
    <div className='mb-1 px-3 py-1'>
      <div className='space-y-0.5'>
        {variables.map(variable => (
          <div key={variable.variable} className='flex items-center h-6 justify-between bg-workflow-block-parma-bg rounded-md px-1 space-x-1'>
            <div className='w-0 grow flex items-center space-x-1'>
              <Variable02 className='shrink-0 w-3.5 h-3.5 text-text-accent' />
              <span className='w-0 grow truncate system-xs-regular text-text-secondary'>{variable.variable}</span>
            </div>

            <div className='ml-1 flex items-center space-x-1'>
              {variable.required && <span className='system-2xs-regular-uppercase text-text-tertiary'>{t(`${i18nPrefix}.required`)}</span>}
              <InputVarTypeIcon type={variable.type} className='w-3 h-3 text-text-tertiary' />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default React.memo(Node)
