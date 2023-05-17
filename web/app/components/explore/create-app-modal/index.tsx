'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'

import cn from 'classnames'
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

  const submit = () => {
    if(!name.trim()) {
      Toast.notify({ type: 'error', message: t('explore.appCustomize.nameRequired') })
      return
    }
    onConfirm({
      name,
    })
    onHide()
  }

  return (
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
          <div className='w-10 h-10 rounded-lg bg-[#EFF1F5]'></div>
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
  )
}

export default CreateAppModal
