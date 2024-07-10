import { useMemo } from 'react'
import { useNodes } from 'reactflow'
import { capitalize } from 'lodash-es'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import type {
  CommonNodeType,
  ValueSelector,
  VarType,
} from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'

type VariableTagProps = {
  valueSelector: ValueSelector
  varType: VarType
}
const VariableTag = ({
  valueSelector,
  varType,
}: VariableTagProps) => {
  const nodes = useNodes<CommonNodeType>()
  const node = useMemo(() => {
    if (isSystemVar(valueSelector))
      return nodes.find(node => node.data.type === BlockEnum.Start)

    return nodes.find(node => node.id === valueSelector[0])
  }, [nodes, valueSelector])

  const variableName = isSystemVar(valueSelector) ? valueSelector.slice(0).join('.') : valueSelector.slice(1).join('.')

  return (
    <div className='inline-flex items-center px-1.5 max-w-full h-6 text-xs rounded-md border-[0.5px] border-[rgba(16, 2440,0.08)] bg-white shadow-xs'>
      {
        node && (
          <VarBlockIcon
            className='shrink-0 mr-0.5 text-[#354052]'
            type={node!.data.type}
          />
        )
      }
      <div
        className='max-w-[60px] truncate text-[#354052] font-medium'
        title={node?.data.title}
      >
        {node?.data.title}
      </div>
      <Line3 className='shrink-0 mx-0.5' />
      <Variable02 className='shrink-0 mr-0.5 w-3.5 h-3.5 text-[#155AEF]' />
      <div
        className='truncate text-[#155AEF] font-medium'
        title={variableName}
      >
        {variableName}
      </div>
      {
        varType && (
          <div className='shrink-0 ml-0.5 text-[#676F83]'>{capitalize(varType)}</div>
        )
      }
    </div>
  )
}

export default VariableTag
