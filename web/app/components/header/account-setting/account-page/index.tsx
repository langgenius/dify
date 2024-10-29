'use client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useContext, useContextSelector } from 'use-context-selector'
import Collapse from '../collapse'
import type { IItem } from '../collapse'
import s from './index.module.css'
import classNames from '@/utils/classnames'
import Modal from '@/app/components/base/modal'
import Confirm from '@/app/components/base/confirm'
import Button from '@/app/components/base/button'
import { updateUserProfile } from '@/service/common'
import AppContext, { useAppContext } from '@/context/app-context'
import { ToastContext } from '@/app/components/base/toast'
import AppIcon from '@/app/components/base/app-icon'
import Avatar from '@/app/components/base/avatar'
import { IS_CE_EDITION } from '@/config'

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

const validPassword = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/

export default function AccountPage() {
  const { t } = useTranslation()
  const { mutateUserProfile, userProfile, apps } = useAppContext()
  const { notify } = useContext(ToastContext)
  const [editNameModalVisible, setEditNameModalVisible] = useState(false)
  const [editName, setEditName] = useState('')
  const [editing, setEditing] = useState(false)
  const [editPasswordModalVisible, setEditPasswordModalVisible] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false)
  const systemFeatures = useContextSelector(AppContext, state => state.systemFeatures)

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

  const showErrorMessage = (message: string) => {
    notify({
      type: 'error',
      message,
    })
  }
  const valid = () => {
    if (!password.trim()) {
      showErrorMessage(t('login.error.passwordEmpty'))
      return false
    }
    if (!validPassword.test(password)) {
      showErrorMessage(t('login.error.passwordInvalid'))
      return false
    }
    if (password !== confirmPassword) {
      showErrorMessage(t('common.account.notEqual'))
      return false
    }

    return true
  }
  const resetPasswordForm = () => {
    setCurrentPassword('')
    setPassword('')
    setConfirmPassword('')
  }
  const handleSavePassword = async () => {
    if (!valid())
      return
    try {
      setEditing(true)
      await updateUserProfile({
        url: 'account/password',
        body: {
          password: currentPassword,
          new_password: password,
          repeat_new_password: confirmPassword,
        },
      })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      mutateUserProfile()
      setEditPasswordModalVisible(false)
      resetPasswordForm()
      setEditing(false)
    }
    catch (e) {
      notify({ type: 'error', message: (e as Error).message })
      setEditPasswordModalVisible(false)
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
      {systemFeatures.enable_email_password_login && (
        <div className='mb-8'>
          <div className='mb-1 text-sm font-medium text-gray-900'>{t('common.account.password')}</div>
          <div className='mb-2 text-xs text-gray-500'>{t('common.account.passwordTip')}</div>
          <Button onClick={() => setEditPasswordModalVisible(true)}>{userProfile.is_password_set ? t('common.account.resetPassword') : t('common.account.setPassword')}</Button>
        </div>
      )}
      <div className='mb-6 border-[0.5px] border-gray-100' />
      <div className='mb-8'>
        <div className={titleClassName}>{t('common.account.langGeniusAccount')}</div>
        <div className={descriptionClassName}>{t('common.account.langGeniusAccountTip')}</div>
        {!!apps.length && (
          <Collapse
            title={`${t('common.account.showAppLength', { length: apps.length })}`}
            items={apps.map(app => ({ key: app.id, name: app.name }))}
            renderItem={renderAppItem}
            wrapperClassName='mt-2'
          />
        )}
        {!IS_CE_EDITION && <Button className='mt-2 text-[#D92D20]' onClick={() => setShowDeleteAccountModal(true)}>{t('common.account.delete')}</Button>}
      </div>
      {editNameModalVisible && (
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
            <Button className='mr-2' onClick={() => setEditNameModalVisible(false)}>{t('common.operation.cancel')}</Button>
            <Button
              disabled={editing || !editName}
              variant='primary'
              onClick={handleSaveName}
            >
              {t('common.operation.save')}
            </Button>
          </div>
        </Modal>
      )}
      {editPasswordModalVisible && (
        <Modal
          isShow
          onClose={() => {
            setEditPasswordModalVisible(false)
            resetPasswordForm()
          }}
          className={s.modal}
        >
          <div className='mb-6 text-lg font-medium text-gray-900'>{userProfile.is_password_set ? t('common.account.resetPassword') : t('common.account.setPassword')}</div>
          {userProfile.is_password_set && (
            <>
              <div className={titleClassName}>{t('common.account.currentPassword')}</div>
              <input
                type="password"
                className={inputClassName}
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
              />
            </>
          )}
          <div className='mt-8 text-sm font-medium text-gray-900'>
            {userProfile.is_password_set ? t('common.account.newPassword') : t('common.account.password')}
          </div>
          <input
            type="password"
            className={inputClassName}
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <div className='mt-8 text-sm font-medium text-gray-900'>{t('common.account.confirmPassword')}</div>
          <input
            type="password"
            className={inputClassName}
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
          />
          <div className='flex justify-end mt-10'>
            <Button className='mr-2' onClick={() => {
              setEditPasswordModalVisible(false)
              resetPasswordForm()
            }}>{t('common.operation.cancel')}</Button>
            <Button
              disabled={editing}
              variant='primary'
              onClick={handleSavePassword}
            >
              {userProfile.is_password_set ? t('common.operation.reset') : t('common.operation.save')}
            </Button>
          </div>
        </Modal>
      )}
      {showDeleteAccountModal && (
        <Confirm
          isShow
          onCancel={() => setShowDeleteAccountModal(false)}
          onConfirm={() => setShowDeleteAccountModal(false)}
          showCancel={false}
          type='warning'
          title={t('common.account.delete')}
          content={
            <>
              <div className='my-1 text-[#D92D20] text-sm leading-5'>
                {t('common.account.deleteTip')}
              </div>
              <div className='mt-3 text-sm leading-5'>
                <span>{t('common.account.deleteConfirmTip')}</span>
                <a
                  className='text-primary-600 cursor'
                  href={`mailto:support@dify.ai?subject=Delete Account Request&body=Delete Account: ${userProfile.email}`}
                  target='_blank'
                  rel='noreferrer noopener'
                  onClick={(e) => {
                    e.preventDefault()
                    window.location.href = e.currentTarget.href
                  }}
                >
                  support@dify.ai
                </a>
              </div>
              <div className='my-2 px-3 py-2 rounded-lg bg-gray-100 text-sm font-medium leading-5 text-gray-800'>{`${t('common.account.delete')}: ${userProfile.email}`}</div>
            </>
          }
          confirmText={t('common.operation.ok') as string}
        />
      )}
    </>
  )
}
