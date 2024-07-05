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
    if (valueSelector[0] === 'sys')
      return nodes.find(node => node.data.type === BlockEnum.Start)

    return nodes.find(node => node.id === valueSelector[0])
  }, [nodes, valueSelector])

  return (
    <div className='inline-flex items-center px-1.5 h-6 text-xs rounded-md border-[0.5px] border-[rgba(16, 2440,0.08)] bg-white shadow-xs'>
      <div className='flex items-center text-[#354052] font-medium'>
        <VarBlockIcon
          className='shrink-0 mr-0.5'
          type={node!.data.type}
        />
        <div className='truncate'>{node!.data.title}</div>
      </div>
      <Line3 className='mx-0.5' />
      <div className='flex items-center mr-0.5 text-[#155AEF] font-medium'>
        <Variable02 className='shrink-0 mr-0.5 w-3.5 h-3.5' />
        <div className='truncate'>{valueSelector.slice(1).join('.')}</div>
      </div>
      <div className='text-[#676F83]'>{capitalize(varType)}</div>
    </div>
  )
}

export default VariableTag
