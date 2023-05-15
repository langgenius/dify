'use client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import { useContext } from 'use-context-selector'
import Collapse from '../collapse'
import type { IItem } from '../collapse'
import s from './index.module.css'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { updateUserProfile } from '@/service/common'
import { useAppContext } from '@/context/app-context'
import { ToastContext } from '@/app/components/base/toast'
import AppIcon from '@/app/components/base/app-icon'
import Avatar from '@/app/components/base/avatar'

const titleClassName = `
  text-sm font-medium text-gray-900
`
const descriptionClassName = `
  mt-1 text-xs font-normal text-gray-500
`
const inputClassName = `
  mt-2 w-full px-3 py-2 bg-gray-100 rounded
  text-sm font-normal text-gray-800
`

export default function AccountPage() {
  const { mutateUserProfile, userProfile, apps } = useAppContext()
  const { notify } = useContext(ToastContext)
  const [editNameModalVisible, setEditNameModalVisible] = useState(false)
  const [editName, setEditName] = useState('')
  const [editing, setEditing] = useState(false)
  const { t } = useTranslation()

  const handleEditName = () => {
    setEditNameModalVisible(true)
    setEditName(userProfile.name)
  }
  const handleSaveName = async () => {
    try {
      setEditing(true)
      await updateUserProfile({ url: 'account/name', body: { name: editName } })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      mutateUserProfile()
      setEditNameModalVisible(false)
      setEditing(false)
    }
    catch (e) {
      notify({ type: 'error', message: (e as Error).message })
      setEditNameModalVisible(false)
      setEditing(false)
    }
  }
  const renderAppItem = (item: IItem) => {
    return (
      <div className='flex px-3 py-1'>
        <div className='mr-3'>
          <AppIcon size='tiny' />
        </div>
        <div className='mt-[3px] text-xs font-medium text-gray-700 leading-[18px]'>{item.name}</div>
      </div>
    )
  }

  return (
    <>
      <div className='mb-8'>
        <div className={titleClassName}>{t('common.account.avatar')}</div>
        <Avatar name={userProfile.name} size={64} className='mt-2' />
      </div>
      <div className='mb-8'>
        <div className={titleClassName}>{t('common.account.name')}</div>
        <div className={classNames('flex items-center justify-between mt-2 w-full h-9 px-3 bg-gray-100 rounded text-sm font-normal text-gray-800 cursor-pointer group')}>
          {userProfile.name}
          <div className='items-center hidden h-6 px-2 text-xs font-normal bg-white border border-gray-200 rounded-md group-hover:flex' onClick={handleEditName}>{t('common.operation.edit')}</div>
        </div>
      </div>
      <div className='mb-8'>
        <div className={titleClassName}>{t('common.account.email')}</div>
        <div className={classNames(inputClassName, 'cursor-pointer')}>{userProfile.email}</div>
      </div>
      {
        !!apps.length && (
          <>
            <div className='mb-6 border-[0.5px] border-gray-100' />
            <div className='mb-8'>
              <div className={titleClassName}>{t('common.account.langGeniusAccount')}</div>
              <div className={descriptionClassName}>{t('common.account.langGeniusAccountTip')}</div>
              <Collapse
                title={`${t('common.account.showAppLength', { length: apps.length })}`}
                items={apps.map(app => ({ key: app.id, name: app.name }))}
                renderItem={renderAppItem}
                wrapperClassName='mt-2'
              />
            </div>
          </>
        )
      }
      {
        editNameModalVisible && (
          <Modal
            isShow
            onClose={() => setEditNameModalVisible(false)}
            className={s.modal}
          >
            <div className='mb-6 text-lg font-medium text-gray-900'>{t('common.account.editName')}</div>
            <div className={titleClassName}>{t('common.account.name')}</div>
            <input
              className={inputClassName}
              value={editName}
              onChange={e => setEditName(e.target.value)}
            />
            <div className='flex justify-end mt-10'>
              <Button className='mr-2 text-sm font-medium' onClick={() => setEditNameModalVisible(false)}>{t('common.operation.cancel')}</Button>
              <Button
                disabled={editing || !editName}
                type='primary'
                className='text-sm font-medium'
                onClick={handleSaveName}
              >
                {t('common.operation.save')}
              </Button>
            </div>
          </Modal>
        )
      }
    </>
  )
}
