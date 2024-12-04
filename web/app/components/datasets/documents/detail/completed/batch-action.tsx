import React, { type FC } from 'react'
import { RiCheckboxCircleLine, RiCloseCircleLine, RiDeleteBinLine } from '@remixicon/react'
import Divider from '@/app/components/base/divider'

type IBatchActionProps = {
  selectedSegmentIds: string[]
  onBatchEnable: () => Promise<void>
  onBatchDisable: () => Promise<void>
  onBatchDelete: () => Promise<void>
  onCancel: () => void
}

const BatchAction: FC<IBatchActionProps> = ({
  selectedSegmentIds,
  onBatchEnable,
  onBatchDisable,
  onBatchDelete,
  onCancel,
}) => {
  return (
    <div className='w-full flex justify-center gap-x-2 absolute bottom-16 z-20'>
      <div className='flex items-center gap-x-1 p-1 rounded-[10px] bg-components-actionbar-bg-accent border border-components-actionbar-border-accent shadow-xl shadow-shadow-shadow-5 backdrop-blur-[5px]'>
        <div className='inline-flex items-center gap-x-2 pl-2 pr-3 py-1'>
          <span className='w-5 h-5 flex items-center justify-center px-1 py-0.5 bg-text-accent rounded-md text-text-primary-on-surface text-xs font-medium'>
            {selectedSegmentIds.length}
          </span>
          <span className='text-text-accent text-[13px] font-semibold leading-[16px]'>Selected</span>
        </div>
        <Divider type='vertical' className='mx-0.5 h-3.5 bg-divider-regular' />
        <div className='flex items-center gap-x-0.5 px-3 py-2'>
          <RiCheckboxCircleLine className='w-4 h-4 text-components-button-ghost-text' />
          <button className='px-0.5 text-components-button-ghost-text text-[13px] font-medium leading-[16px]' onClick={onBatchEnable}>
            Enable
          </button>
        </div>
        <div className='flex items-center gap-x-0.5 px-3 py-2'>
          <RiCloseCircleLine className='w-4 h-4 text-components-button-ghost-text' />
          <button className='px-0.5 text-components-button-ghost-text text-[13px] font-medium leading-[16px]' onClick={onBatchDisable}>
            Disable
          </button>
        </div>
        <div className='flex items-center gap-x-0.5 px-3 py-2'>
          <RiDeleteBinLine className='w-4 h-4 text-components-button-destructive-ghost-text' />
          <button className='px-0.5 text-components-button-destructive-ghost-text text-[13px] font-medium leading-[16px]' onClick={onBatchDelete}>
            Delete
          </button>
        </div>
        <Divider type='vertical' className='mx-0.5 h-3.5 bg-divider-regular' />
        <button className='px-3.5 py-2 text-components-button-ghost-text text-[13px] font-medium leading-[16px]' onClick={onCancel}>
            Cancel
        </button>
      </div>
    </div>
  )
}

export default React.memo(BatchAction)
