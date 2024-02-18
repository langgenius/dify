import type {
  FC,
  ReactNode,
} from 'react'
import { useState } from 'react'
import { useWorkflowContext } from '../../context'
import BlockIcon from '../../block-icon'
import { getBlockByType } from '../../block-selector/utils'
import NextStep from './components/next-step'
import {
  LogIn04,
  LogOut04,
  XClose,
} from '@/app/components/base/icons/src/vender/line/general'
import { GitBranch01 } from '@/app/components/base/icons/src/vender/line/development'

enum TabEnum {
  Inputs = 'inputs',
  Outputs = 'outputs',
}

type BasePanelProps = {
  defaultElement?: ReactNode
  inputsElement?: ReactNode
  outputsElement?: ReactNode
}

const BasePanel: FC<BasePanelProps> = ({
  defaultElement,
  inputsElement,
  outputsElement,
}) => {
  const initialActiveTab = inputsElement ? TabEnum.Inputs : outputsElement ? TabEnum.Outputs : ''
  const [activeTab, setActiveTab] = useState(initialActiveTab)
  const {
    handleSelectedNodeIdChange,
    selectedNode,
  } = useWorkflowContext()

  return (
    <div className='absolute top-2 right-2 bottom-2 w-[420px] bg-white shadow-lg border-[0.5px] border-gray-200 rounded-2xl z-20 overflow-y-auto'>
      <div className='sticky top-0 bg-white border-b-[0.5px] border-black/5'>
        <div className='flex items-center px-4 pt-3'>
          <BlockIcon
            className='shrink-0 mr-2'
            type={selectedNode!.data.type}
            size='md'
          />
          <div className='grow py-1 text-base text-gray-900 font-semibold '>{getBlockByType(selectedNode!.data.type)?.title}</div>
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
        {
          (inputsElement || outputsElement) && (
            <div className='flex items-center px-4 h-[42px] text-[13px] font-semibold text-gray-400'>
              {
                inputsElement && (
                  <div
                    className={`relative flex items-center h-full cursor-pointer ${activeTab === TabEnum.Inputs && 'text-gray-700'}`}
                    onClick={() => setActiveTab(TabEnum.Inputs)}
                  >
                    <LogIn04 className='mr-1 w-4 h-4' />
                    INPUTS
                    {
                      activeTab === TabEnum.Inputs && <div className='absolute left-0 bottom-0 w-full h-0.5 bg-primary-600' />
                    }
                  </div>
                )
              }
              {
                outputsElement && (
                  <div
                    className={`relative flex items-center ml-4 h-full cursor-pointer ${activeTab === TabEnum.Outputs && 'text-gray-700'}`}
                    onClick={() => setActiveTab(TabEnum.Outputs)}
                  >
                    <LogOut04 className='mr-1 w-4 h-4' />
                    OUTPUTS
                    {
                      activeTab === TabEnum.Outputs && <div className='absolute left-0 bottom-0 w-full h-0.5 bg-primary-600' />
                    }
                  </div>
                )
              }
            </div>
          )
        }
      </div>
      <div className='py-2 border-b-[0.5px] border-black/5'>
        {defaultElement}
        {activeTab === TabEnum.Inputs && inputsElement}
        {activeTab === TabEnum.Outputs && outputsElement}
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

export default BasePanel
