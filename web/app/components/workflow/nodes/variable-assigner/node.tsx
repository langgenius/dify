import type { FC } from 'react'
import React from 'react'
import type { NodeProps } from 'reactflow'
import { useTranslation } from 'react-i18next'
import { NodeTargetHandle } from '../_base/components/node-handle'
import { BlockEnum } from '../../types'
import type { VariableAssignerNodeType } from './types'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import {
  useWorkflow,
} from '@/app/components/workflow/hooks'

const i18nPrefix = 'workflow.nodes.variableAssigner'

const Node: FC<NodeProps<VariableAssignerNodeType>> = (props) => {
  const { t } = useTranslation()
  const { id, data } = props
  const { variables: originVariables, output_type } = data
  const { getTreeLeafNodes } = useWorkflow()

  const availableNodes = getTreeLeafNodes(id)
  const variables = originVariables.filter(item => item.length > 0)

  return (
    <div className='mb-1 px-3 py-1'>
      <div className='mb-0.5 leading-4 text-xs font-medium text-gray-500 uppercase'>{t(`${i18nPrefix}.title`)}</div>
      {
        variables.length === 0 && (
          <div className='relative flex items-center h-6 justify-between bg-gray-100 rounded-md  px-1 space-x-1 text-xs font-normal text-gray-400 uppercase'>
            {t(`${i18nPrefix}.varNotSet`)}
            <NodeTargetHandle
              {...props}
              handleId='varNotSet'
              handleClassName='!top-1/2 !-translate-y-1/2 !-left-[21px]'
            />
          </div>
        )
      }
      {variables.length > 0 && (
        <>
          <div className='space-y-0.5'>
            {variables.map((item, index) => {
              const node = availableNodes.find(node => node.id === item[0])
              const varName = item[item.length - 1]

              return (
                <div key={index} className='relative flex items-center h-6 bg-gray-100 rounded-md  px-1 text-xs font-normal text-gray-700' >
                  <NodeTargetHandle
                    {...props}
                    handleId={item[0]}
                    handleClassName='!top-1/2 !-translate-y-1/2 !-left-[21px]'
                  />
                  <div className='flex items-center'>
                    <div className='p-[1px]'>
                      <VarBlockIcon
                        className='!text-gray-900'
                        type={(node?.data.type as BlockEnum) || BlockEnum.Start}
                      />
                    </div>
                    <div className='max-w-[85px] truncate mx-0.5 text-xs font-medium text-gray-700' title={node?.data.title}>{node?.data.title}</div>
                    <Line3 className='mr-0.5'></Line3>
                  </div>
                  <div className='flex items-center text-primary-600'>
                    <Variable02 className='w-3.5 h-3.5' />
                    <div className='max-w-[75px] truncate ml-0.5 text-xs font-medium' title={varName}>{varName}</div>
                  </div>
                  {/* <div className='ml-0.5 text-xs font-normal text-gray-500'>{output_type}</div> */}
                </div>
              )
            },

            )}
          </div>
          <div className='mt-2 flex items-center h-6 justify-between bg-gray-100 rounded-md  px-1 space-x-1 text-xs font-normal text-gray-700'>
            <div className='text-xs font-medium text-gray-500 uppercase'>
              {t(`${i18nPrefix}.outputType`)}
            </div>
            <div className='text-xs font-normal text-gray-700'>
              {t(`${i18nPrefix}.type.${output_type}`)}
            </div>
          </div>
        </>
      )
      }
    </div >
  )
}

export default React.memo(Node)
