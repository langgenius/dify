import type { FC } from 'react'
import {
  memo,
  useRef,
} from 'react'
import type { NodeProps } from 'reactflow'
import { useTranslation } from 'react-i18next'
import { useClickAway } from 'ahooks'
import {
  useNodeDataUpdate,
  useWorkflow,
} from '../../hooks'
import { BlockEnum } from '../../types'
import NodeHandle from './components/node-handle'
import AddVariable from './components/add-variable'
import AddVariablePopup from './components/add-variable/add-variable-popup'
import type { VariableAssignerNodeType } from './types'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'

const i18nPrefix = 'workflow.nodes.variableAssigner'

const Node: FC<NodeProps<VariableAssignerNodeType>> = (props) => {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const { id, data } = props
  const { variables: originVariables } = data
  const { getTreeLeafNodes } = useWorkflow()
  const { handleNodeDataUpdate } = useNodeDataUpdate()
  const connected = !!data._connectedTargetHandleIds?.includes('target')

  const availableNodes = getTreeLeafNodes(id)
  const variables = originVariables.filter(item => item.length > 0)

  useClickAway(() => {
    handleNodeDataUpdate({ id, data: { _showVariablePicker: false } })
  }, ref)

  return (
    <div className='relative mb-1 py-1' ref={ref}>
      {
        data._showVariablePicker && (
          <div className='absolute right-6 top-0 z-[3]'>
            <AddVariablePopup
              nodeId={id}
              data={data}
            />
          </div>
        )
      }
      <div className='relative flex items-center mb-0.5 px-3 h-4 text-xs font-medium text-gray-500 uppercase'>
        <NodeHandle connected={connected} />
        <AddVariable
          nodeId={id}
          data={data}
        />
        {t(`${i18nPrefix}.title`)}
      </div>
      {
        variables.length === 0 && (
          <div className='px-3'>
            <div className='relative flex items-center px-1 h-6 justify-between bg-gray-100 rounded-md space-x-1 text-xs font-normal text-gray-400 uppercase'>
              {t(`${i18nPrefix}.varNotSet`)}
            </div>
          </div>
        )
      }
      {variables.length > 0 && (
        <>
          <div className='space-y-0.5 px-3'>
            {variables.map((item, index) => {
              const node = availableNodes.find(node => node.id === item[0])
              const varName = item[item.length - 1]

              return (
                <div key={index} className='relative flex items-center h-6 bg-gray-100 rounded-md  px-1 text-xs font-normal text-gray-700' >
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
                </div>
              )
            },

            )}
          </div>
        </>
      )
      }
    </div >
  )
}

export default memo(Node)
