'use client'
import type { FC } from 'react'
import React from 'react'
import { useRouter } from 'next/navigation'
import { RiDeleteBinLine, RiInformation2Line, RiLoopLeftLine } from '@remixicon/react'

type Props = {
  pluginId: string
  isShowFetchNewVersion: boolean
  isShowInfo: boolean
  isShowDelete: boolean
  onDelete: () => void
}

const Action: FC<Props> = ({
  isShowFetchNewVersion,
  isShowInfo,
  isShowDelete,
  onDelete,
}) => {
  const router = useRouter()

  const handleFetchNewVersion = () => { }
  const handleShowInfo = () => {
    router.refresh() // refresh the page ...
  }
  // const handleDelete = () => { }
  return (
    <div className='flex space-x-1'>
      {isShowFetchNewVersion
        && <div className='p-0.5 cursor-pointer' onClick={handleFetchNewVersion}>
          <RiLoopLeftLine className='w-5 h-5 text-text-tertiary' />
        </div>
      }
      {
        isShowInfo
        && <div className='p-0.5 cursor-pointer' onClick={handleShowInfo}>
          <RiInformation2Line className='w-5 h-5 text-text-tertiary' />
        </div>
      }
      {
        isShowDelete
        && <div className='p-0.5 cursor-pointer' onClick={onDelete}>
          <RiDeleteBinLine className='w-5 h-5 text-text-tertiary' />
        </div>
      }
    </div>
  )
}
export default React.memo(Action)
