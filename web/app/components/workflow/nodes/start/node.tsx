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
          <div key={variable.variable} className='flex h-6 items-center justify-between space-x-1 rounded-md  bg-gray-100 px-1 text-xs font-normal text-gray-700'>
            <div className='flex w-0 grow items-center space-x-1'>
              <Variable02 className='text-primary-500 h-3.5 w-3.5 shrink-0' />
              <span className='w-0 grow truncate text-xs font-normal text-gray-700'>{variable.variable}</span>
            </div>

            <div className='ml-1 flex items-center space-x-1'>
              {variable.required && <span className='text-xs font-normal uppercase text-gray-500'>{t(`${i18nPrefix}.required`)}</span>}
              <InputVarTypeIcon type={variable.type} className='h-3 w-3 text-gray-500' />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default React.memo(Node)
