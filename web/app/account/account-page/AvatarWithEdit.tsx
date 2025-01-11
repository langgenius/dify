'use client'

import React, { useCallback, useState } from 'react'
import { updateUserProfile } from '@/service/common'
import Avatar from '@/app/components/base/avatar'
import AvatarIconPicker, { type AppIconSelection } from '@/app/components/base/app-icon-picker'

type AvatarWithEditProps = {
  name: string
  avatar: string | null
  size?: number
  className?: string
  textClassName?: string
  onSelect?: () => void
}

const AvatarWithEdit = ({ onSelect, ...props }: AvatarWithEditProps) => {
  const [isShowAvatarIconPicker, setIsShowAvaterIconPicker] = useState(false)

  const selectAvatarHandler = useCallback(async (payload: AppIconSelection) => {
    if (payload.type === 'image')
      await updateUserProfile({ url: 'account/avatar', body: { avatar: payload.fileId } })

    setIsShowAvaterIconPicker(false)
    onSelect?.()
  }, [onSelect])

  return (
    <>
      <div
        onClick={() => { setIsShowAvaterIconPicker(true) }}
      >
        <div className="relative group">
          <Avatar {...props} />
          <div
            onClick={() => { setIsShowAvaterIconPicker(true) }}
            className="absolute inset-0 bg-black bg-opacity-50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center"
          >
            <span className="text-white text-xs">変更</span>
          </div>
        </div>
      </div>

      { isShowAvatarIconPicker && <AvatarIconPicker onClose={() => { setIsShowAvaterIconPicker(false) }} onSelect={selectAvatarHandler} /> }
    </>
  )
}

export default AvatarWithEdit
