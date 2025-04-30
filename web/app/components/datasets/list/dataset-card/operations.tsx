import Divider from '@/app/components/base/divider'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiDeleteBinLine, RiEditLine, RiFileCopyLine } from '@remixicon/react'

type OperationsProps = {
  showDelete: boolean
  openRenameModal: () => void
  detectIsUsedByApp: () => void
}

const Operations = ({
  showDelete,
  openRenameModal,
  detectIsUsedByApp,
}: OperationsProps) => {
  const { t } = useTranslation()

  const onClickRename = async (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    openRenameModal()
  }

  const onClickDelete = async (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    detectIsUsedByApp()
  }

  return (
    <div className='relative flex w-full flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5'>
      <div className='flex flex-col p-1'>
        <div
          className='flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover'
          onClick={onClickRename}
        >
          <RiEditLine className='size-4 text-text-tertiary' />
          <span className='system-md-regular px-1 text-text-secondary'>
            {t('common.operation.edit')}
          </span>
        </div>
        <div
          className='flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover'
          onClick={() => { console.log('duplicate') }}
        >
          <RiFileCopyLine className='size-4 text-text-tertiary' />
          <span className='system-md-regular px-1 text-text-secondary'>
            {t('common.operation.duplicate')}
          </span>
        </div>
      </div>
      <Divider type='horizontal' className='my-0 bg-divider-subtle' />
      <div className='flex flex-col p-1'>
        <div
          className='flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover'
          onClick={() => { console.log('Export') }}
        >
          <RiEditLine className='size-4 text-text-tertiary' />
          <span className='system-md-regular px-1 text-text-secondary'>
            Export Solution
          </span>
        </div>
        <div
          className='flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover'
          onClick={() => { console.log('Import') }}
        >
          <RiFileCopyLine className='size-4 text-text-tertiary' />
          <span className='system-md-regular px-1 text-text-secondary'>
            Import Solution
          </span>
        </div>
      </div>
      {showDelete && (
        <>
          <Divider type='horizontal' className='my-0 bg-divider-subtle' />
          <div className='flex flex-col p-1'>
            <div
              className='group flex cursor-pointer items-center gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-destructive-hover'
              onClick={onClickDelete}
            >
              <RiDeleteBinLine className='size-4 text-text-tertiary group-hover:text-text-destructive' />
              <span className='system-md-regular px-1 text-text-secondary group-hover:text-text-destructive'>
                {t('common.operation.delete')}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default React.memo(Operations)
