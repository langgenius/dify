import { RiMindMap } from '@remixicon/react'

const FailBranchCard = () => {
  return (
    <div className='pt-2 px-4'>
      <div className='p-4 rounded-[10px] bg-workflow-process-bg'>
        <div className='flex items-center justify-center mb-2 w-8 h-8 rounded-[10px] border-[0.5px] bg-components-card-bg shadow-lg'>
          <RiMindMap className='w-5 h-5 text-text-tertiary' />
        </div>
        <div className='mb-1 system-sm-medium text-text-secondary'>Go to the canvas to customize the fail branch logic.</div>
        <div className='system-xs-regular text-text-tertiary'>
          When the fail branch is activated, exceptions thrown by nodes will not terminate the process. Instead, it will automatically execute the predefined fail branch, allowing you to flexibly provide error messages, reports, fixes, or skip actions.
        </div>
      </div>
    </div>
  )
}

export default FailBranchCard
