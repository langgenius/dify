'use client'
import React, { useState } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import AppIcon from '@/app/components/base/app-icon'
import EmojiPicker from '@/app/components/base/emoji-picker'

import s from './style.module.css'

type IProps = {
  appName: string,
  show: boolean,
  onConfirm: (info: any) => void,
  onHide: () => void,
}

const CreateAppModal = ({
  appName,
  show = false,
  onConfirm,
  onHide,
}: IProps) => {
  const { t } = useTranslation()

  const [name, setName] = React.useState('')

  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [emoji, setEmoji] = useState({ icon: '🤖', icon_background: '#FFEAD5' })

  const submit = () => {
    if(!name.trim()) {
      Toast.notify({ type: 'error', message: t('explore.appCustomize.nameRequired') })
      return
    }
    onConfirm({
      name,
      ...emoji,
    })
    onHide()
  }

  return (
    <>
    <Modal
      isShow={show}
      onClose={onHide}
      className={cn(s.modal, '!max-w-[480px]', 'px-8')}
    >
      <span className={s.close} onClick={onHide}/>
      <div className={s.title}>{t('explore.appCustomize.title', {name: appName})}</div>
      <div className={s.content}>
        <div className={s.subTitle}>{t('explore.appCustomize.subTitle')}</div>
        <div className='flex items-center justify-between space-x-3'>
          <AppIcon size='large' onClick={() => { setShowEmojiPicker(true) }} className='cursor-pointer' icon={emoji.icon} background={emoji.icon_background} />
          <input 
            value={name}
            onChange={e => setName(e.target.value)}
            className='h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg grow'
          />
        </div>
      </div>      
      <div className='flex flex-row-reverse'>
        <Button className='w-24 ml-2' type='primary' onClick={submit}>{t('common.operation.create')}</Button>
        <Button className='w-24' onClick={onHide}>{t('common.operation.cancel')}</Button>
      </div>
    </Modal>
    {showEmojiPicker && <EmojiPicker
      onSelect={(icon, icon_background) => {
        console.log(icon, icon_background)
        setEmoji({ icon, icon_background })
        setShowEmojiPicker(false)
      }}
      onClose={() => {
        setEmoji({ icon: '🤖', icon_background: '#FFEAD5' })
        setShowEmojiPicker(false)
      }}
    />}
    </>
    
  )
}

export default CreateAppModal
