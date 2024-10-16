'use client'
import type { FC } from 'react'
import React from 'react'
import { useRouter } from 'next/navigation'
import { RiDeleteBinLine, RiInformation2Line, RiLoopLeftLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import PluginInfo from '../plugin-page/plugin-info'
import ActionButton from '../../base/action-button'

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
  const [isShowPluginInfo, {
    setTrue: showPluginInfo,
    setFalse: hidePluginInfo,
  }] = useBoolean(false)

  const handleFetchNewVersion = () => { }

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
        && <ActionButton onClick={showPluginInfo}>
          <RiInformation2Line className='w-5 h-5 text-text-tertiary' />
        </ActionButton>
      }
      {
        isShowDelete
        && <div className='p-0.5 cursor-pointer' onClick={onDelete}>
          <RiDeleteBinLine className='w-5 h-5 text-text-tertiary' />
        </div>
      }

      {isShowPluginInfo && (
        <PluginInfo
          repository='https://github.com/langgenius/dify-github-plugin'
          release='1.2.5'
          packageName='notion-sync.difypkg'
          onHide={hidePluginInfo}
        />
      )}
    </div>
  )
}
export default React.memo(Action)
