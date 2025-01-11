'use client'

import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { updateUserProfile } from '@/service/common'
import { ToastContext } from '@/app/components/base/toast'
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
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)

  const [isShowAvatarIconPicker, setIsShowAvaterIconPicker] = useState(false)

  const selectAvatarHandler = useCallback(async (payload: AppIconSelection) => {
    try {
      if (payload.type === 'image')
        await updateUserProfile({ url: 'account/avatar', body: { avatar: payload.fileId } })

      setIsShowAvaterIconPicker(false)
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      onSelect?.()
    }

    catch (e) {
      notify({ type: 'error', message: (e as Error).message })
    }
  }, [notify, onSelect, t])

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
