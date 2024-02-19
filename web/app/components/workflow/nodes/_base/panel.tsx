import type {
  FC,
  ReactElement,
} from 'react'
import {
  cloneElement,
  memo,
} from 'react'
import type { NodeProps } from 'reactflow'
import { useWorkflowContext } from '../../context'
import BlockIcon from '../../block-icon'
import NextStep from './components/next-step'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'
import { GitBranch01 } from '@/app/components/base/icons/src/vender/line/development'

type BasePanelProps = {
  children: ReactElement
} & Pick<NodeProps, 'id' | 'data'>

const BasePanel: FC<BasePanelProps> = ({
  id,
  data,
  children,
}) => {
  const {
    handleSelectedNodeIdChange,
    selectedNode,
  } = useWorkflowContext()

  return (
    <div className='absolute top-14 right-2 bottom-2 w-[420px] bg-white shadow-lg border-[0.5px] border-gray-200 rounded-2xl z-10 overflow-y-auto'>
      <div className='sticky top-0 bg-white border-b-[0.5px] border-black/5'>
        <div className='flex items-center px-4 pt-3'>
          <BlockIcon
            className='shrink-0 mr-2'
            type={selectedNode!.data.type}
            size='md'
          />
          <div className='grow py-1 text-base text-gray-900 font-semibold '>{data.title}</div>
          <div className='shrink-0 flex items-center'>
            <div
              className='flex items-center justify-center w-6 h-6 cursor-pointer'
              onClick={() => handleSelectedNodeIdChange('')}
            >
              <XClose className='w-4 h-4 text-gray-500' />
            </div>
          </div>
        </div>
        <div className='p-2'>
          <div className='py-[5px] pl-1.5 pr-2 text-xs text-gray-400'>
            Add description...
          </div>
        </div>
      </div>
      <div className='py-2 border-b-[0.5px] border-black/5'>
        {cloneElement(children, { id, data })}
      </div>
      <div className='p-4'>
        <div className='flex items-center mb-1 text-gray-700 text-[13px] font-semibold'>
          <GitBranch01 className='mr-1 w-4 h-4' />
          NEXT STEP
        </div>
        <div className='mb-2 text-xs text-gray-400'>
          Add the next block in this workflow
        </div>
        <NextStep selectedNode={selectedNode!} />
      </div>
    </div>
  )
}

export default memo(BasePanel)
