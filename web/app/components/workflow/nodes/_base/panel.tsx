import type {
  FC,
  ReactNode,
} from 'react'

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
  return (
    <div className='absolute top-2 right-2 bottom-2 w-[420px] shadow-lg border-[0.5px] border-gray-200 rounded-2xl'>
      <div className='flex items-center px-4 pt-3'>
        <div className='mr-2 w-6 h-6'></div>
        <div className='py-1 text-base text-gray-900 font-semibold '>LLM</div>
      </div>
      <div className='p-2'>
        <div className='py-[5px] pl-1.5 pr-2 text-xs text-gray-400'>
          Add description...
        </div>
      </div>
      <div className='flex items-center px-4 h-[42px]'>
        inputs
      </div>
      <div className='py-2 border-t-[0.5px] border-b-[0.5px] border-black/5'>
        {defaultElement}
        {inputsElement}
        {ouputsElement}
      </div>
      <div className='p-4'></div>
    </div>
  )
}

export default BasePanel
