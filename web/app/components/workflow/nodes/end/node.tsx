import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { EndNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.nodes.end'

const Node: FC<NodeProps<EndNodeType>> = ({
  data,
}) => {
  const { t } = useTranslation()
  const { outputs } = data
  return (
    <div className='px-3'>
      <div className='flex items-center h-6 justify-between bg-gray-100 rounded-md  px-1 space-x-1 text-xs font-normal text-gray-700'>
        <div className='text-xs font-medium text-gray-500 uppercase'>
          {t(`${i18nPrefix}.outputs`)}
        </div>
        <div className='text-xs font-normal text-gray-700'>
          {t(`${i18nPrefix}.type.${outputs.type}`)}
        </div>
      </div>
    </div>
  )
}

export default React.memo(Node)
