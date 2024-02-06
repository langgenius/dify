import type {
  FC,
  ReactNode,
} from 'react'
import { useState } from 'react'
import { useWorkflowContext } from '../../context'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'

enum TabEnum {
  Inputs = 'inputs',
  Outputs = 'outputs',
}

type BasePanelProps = {
  defaultElement?: ReactNode
  inputsElement?: ReactNode
  ouputsElement?: ReactNode
}

const BasePanel: FC<BasePanelProps> = ({
  defaultElement,
  inputsElement,
  ouputsElement,
}) => {
  const initialActiveTab = inputsElement ? TabEnum.Inputs : ouputsElement ? TabEnum.Outputs : ''
  const [activeTab, setActiveTab] = useState(initialActiveTab)
  const { handleSelectedNodeIdChange } = useWorkflowContext()

  return (
    <div className='absolute top-2 right-2 bottom-2 w-[420px] bg-white shadow-lg border-[0.5px] border-gray-200 rounded-2xl z-20'>
      <div className='flex items-center px-4 pt-3'>
        <div className='shrink-0 mr-2 w-6 h-6'></div>
        <div className='grow py-1 text-base text-gray-900 font-semibold '>LLM</div>
        <div className='shrink-0 flex items-center'>
          <div
            className='w-6 h-6 cursor-pointer'
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
      {
        (inputsElement || ouputsElement) && (
          <div className='flex items-center px-4 h-[42px]'>
            {
              inputsElement && (
                <div
                  className='cursor-pointer'
                  onClick={() => setActiveTab(TabEnum.Inputs)}
                >
                  inputs
                </div>
              )
            }
            {
              ouputsElement && (
                <div
                  className='ml-4 cursor-pointer'
                  onClick={() => setActiveTab(TabEnum.Outputs)}
                >
                  outpus
                </div>
              )
            }
          </div>
        )
      }
      <div className='py-2 border-t-[0.5px] border-b-[0.5px] border-black/5'>
        {defaultElement}
        {activeTab === TabEnum.Inputs && inputsElement}
        {activeTab === TabEnum.Outputs && ouputsElement}
      </div>
      <div className='p-4'>
        next step
      </div>
    </div>
  )
}

export default BasePanel
