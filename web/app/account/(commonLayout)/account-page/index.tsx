'use client'
import type { IItem } from '@/app/components/header/account-setting/collapse'
import type { App } from '@/types/app'
import {
  RiGraduationCapFill,
} from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Modal from '@/app/components/base/modal'
import PremiumBadge from '@/app/components/base/premium-badge'
import { ToastContext } from '@/app/components/base/toast'
import Collapse from '@/app/components/header/account-setting/collapse'
import { IS_CE_EDITION, validPassword } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useProviderContext } from '@/context/provider-context'
import { updateUserProfile } from '@/service/common'
import { useAppList } from '@/service/use-apps'
import DeleteAccount from '../delete-account'

import AvatarWithEdit from './AvatarWithEdit'
import EmailChangeModal from './email-change-modal'

const titleClassName = `
  system-sm-semibold text-text-secondary
`
const descriptionClassName = `
  mt-1 body-xs-regular text-text-tertiary
`

export default function AccountPage() {
  const { t } = useTranslation()
  const { systemFeatures } = useGlobalPublicStore()
  const { data: appList } = useAppList({ page: 1, limit: 100, name: '' })
  const apps = appList?.data || []
  const { mutateUserProfile, userProfile } = useAppContext()
  const { isEducationAccount } = useProviderContext()
  const { notify } = useContext(ToastContext)
  const [editNameModalVisible, setEditNameModalVisible] = useState(false)
  const [editName, setEditName] = useState('')
  const [editing, setEditing] = useState(false)
  const [editPasswordModalVisible, setEditPasswordModalVisible] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false)
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [showUpdateEmail, setShowUpdateEmail] = useState(false)

  const handleEditName = () => {
    setEditNameModalVisible(true)
    setEditName(userProfile.name)
  }
  const handleSaveName = async () => {
    try {
      setEditing(true)
      await updateUserProfile({ url: 'account/name', body: { name: editName } })
      notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
      mutateUserProfile()
      setEditNameModalVisible(false)
      setEditing(false)
    }
    catch (e) {
      notify({ type: 'error', message: (e as Error).message })
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
      showErrorMessage(t('error.passwordEmpty', { ns: 'login' }))
      return false
    }
    if (!validPassword.test(password)) {
      showErrorMessage(t('error.passwordInvalid', { ns: 'login' }))
      return false
    }
    if (password !== confirmPassword) {
      showErrorMessage(t('account.notEqual', { ns: 'common' }))
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
      notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
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
    const { icon, icon_background, icon_type, icon_url } = item as any
    return (
      <div className="flex px-3 py-1">
        <div className="mr-3">
          <AppIcon
            size="tiny"
            iconType={icon_type}
            icon={icon}
            background={icon_background}
            imageUrl={icon_url}
          />
        </div>
        <div className="system-sm-medium mt-[3px] text-text-secondary">{item.name}</div>
      </div>
    )
  }

  return (
    <>
      <div className="pb-3 pt-2">
        <h4 className="title-2xl-semi-bold text-text-primary">{t('account.myAccount', { ns: 'common' })}</h4>
      </div>
      <div className="mb-8 flex items-center rounded-xl bg-gradient-to-r from-background-gradient-bg-fill-chat-bg-2 to-background-gradient-bg-fill-chat-bg-1 p-6">
        <AvatarWithEdit avatar={userProfile.avatar_url} name={userProfile.name} onSave={mutateUserProfile} size={64} />
        <div className="ml-4">
          <p className="system-xl-semibold text-text-primary">
            {userProfile.name}
            {isEducationAccount && (
              <PremiumBadge size="s" color="blue" className="ml-1 !px-2">
                <RiGraduationCapFill className="mr-1 h-3 w-3" />
                <span className="system-2xs-medium">EDU</span>
              </PremiumBadge>
            )}
          </p>
          <p className="system-xs-regular text-text-tertiary">{userProfile.email}</p>
        </div>
      </div>
      <div className="mb-8">
        <div className={titleClassName}>{t('account.name', { ns: 'common' })}</div>
        <div className="mt-2 flex w-full items-center justify-between gap-2">
          <div className="system-sm-regular flex-1 rounded-lg bg-components-input-bg-normal p-2 text-components-input-text-filled ">
            <span className="pl-1">{userProfile.name}</span>
          </div>
          <div className="system-sm-medium cursor-pointer rounded-lg bg-components-button-tertiary-bg px-3 py-2 text-components-button-tertiary-text" onClick={handleEditName}>
            {t('operation.edit', { ns: 'common' })}
          </div>
        </div>
      </div>
      <div className="mb-8">
        <div className={titleClassName}>{t('account.email', { ns: 'common' })}</div>
        <div className="mt-2 flex w-full items-center justify-between gap-2">
          <div className="system-sm-regular flex-1 rounded-lg bg-components-input-bg-normal p-2 text-components-input-text-filled ">
            <span className="pl-1">{userProfile.email}</span>
          </div>
          {systemFeatures.enable_change_email && (
            <div className="system-sm-medium cursor-pointer rounded-lg bg-components-button-tertiary-bg px-3 py-2 text-components-button-tertiary-text" onClick={() => setShowUpdateEmail(true)}>
              {t('operation.change', { ns: 'common' })}
            </div>
          )}
        </div>
      </div>
      {
        systemFeatures.enable_email_password_login && (
          <div className="mb-8 flex justify-between gap-2">
            <div>
              <div className="system-sm-semibold mb-1 text-text-secondary">{t('account.password', { ns: 'common' })}</div>
              <div className="body-xs-regular mb-2 text-text-tertiary">{t('account.passwordTip', { ns: 'common' })}</div>
            </div>
            <Button onClick={() => setEditPasswordModalVisible(true)}>{userProfile.is_password_set ? t('account.resetPassword', { ns: 'common' }) : t('account.setPassword', { ns: 'common' })}</Button>
          </div>
        )
      }
      <div className="mb-6 border-[1px] border-divider-subtle" />
      <div className="mb-8">
        <div className={titleClassName}>{t('account.langGeniusAccount', { ns: 'common' })}</div>
        <div className={descriptionClassName}>{t('account.langGeniusAccountTip', { ns: 'common' })}</div>
        {!!apps.length && (
          <Collapse
            title={`${t('account.showAppLength', { ns: 'common', length: apps.length })}`}
            items={apps.map((app: App) => ({ ...app, key: app.id, name: app.name }))}
            renderItem={renderAppItem}
            wrapperClassName="mt-2"
          />
        )}
        {!IS_CE_EDITION && <Button className="mt-2 text-components-button-destructive-secondary-text" onClick={() => setShowDeleteAccountModal(true)}>{t('account.delete', { ns: 'common' })}</Button>}
      </div>
      {
        editNameModalVisible && (
          <Modal
            isShow
            onClose={() => setEditNameModalVisible(false)}
            className="!w-[420px] !p-6"
          >
            <div className="title-2xl-semi-bold mb-6 text-text-primary">{t('account.editName', { ns: 'common' })}</div>
            <div className={titleClassName}>{t('account.name', { ns: 'common' })}</div>
            <Input
              className="mt-2"
              value={editName}
              onChange={e => setEditName(e.target.value)}
            />
            <div className="mt-10 flex justify-end">
              <Button className="mr-2" onClick={() => setEditNameModalVisible(false)}>{t('operation.cancel', { ns: 'common' })}</Button>
              <Button
                disabled={editing || !editName}
                variant="primary"
                onClick={handleSaveName}
              >
                {t('operation.save', { ns: 'common' })}
              </Button>
            </div>
          </Modal>
        )
      }
      {
        editPasswordModalVisible && (
          <Modal
            isShow
            onClose={() => {
              setEditPasswordModalVisible(false)
              resetPasswordForm()
            }}
            className="!w-[420px] !p-6"
          >
            <div className="title-2xl-semi-bold mb-6 text-text-primary">{userProfile.is_password_set ? t('account.resetPassword', { ns: 'common' }) : t('account.setPassword', { ns: 'common' })}</div>
            {userProfile.is_password_set && (
              <>
                <div className={titleClassName}>{t('account.currentPassword', { ns: 'common' })}</div>
                <div className="relative mt-2">
                  <Input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                  />

                  <div className="absolute inset-y-0 right-0 flex items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    >
                      {showCurrentPassword ? '👀' : '😝'}
                    </Button>
                  </div>
                </div>
              </>
            )}
            <div className="system-sm-semibold mt-8 text-text-secondary">
              {userProfile.is_password_set ? t('account.newPassword', { ns: 'common' }) : t('account.password', { ns: 'common' })}
            </div>
            <div className="relative mt-2">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
              <div className="absolute inset-y-0 right-0 flex items-center">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? '👀' : '😝'}
                </Button>
              </div>
            </div>
            <div className="system-sm-semibold mt-8 text-text-secondary">{t('account.confirmPassword', { ns: 'common' })}</div>
            <div className="relative mt-2">
              <Input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
              />
              <div className="absolute inset-y-0 right-0 flex items-center">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? '👀' : '😝'}
                </Button>
              </div>
            </div>
            <div className="mt-10 flex justify-end">
              <Button
                className="mr-2"
                onClick={() => {
                  setEditPasswordModalVisible(false)
                  resetPasswordForm()
                }}
              >
                {t('operation.cancel', { ns: 'common' })}
              </Button>
              <Button
                disabled={editing}
                variant="primary"
                onClick={handleSavePassword}
              >
                {userProfile.is_password_set ? t('operation.reset', { ns: 'common' }) : t('operation.save', { ns: 'common' })}
              </Button>
            </div>
          </Modal>
        )
      }
      {
        showDeleteAccountModal && (
          <DeleteAccount
            onCancel={() => setShowDeleteAccountModal(false)}
            onConfirm={() => setShowDeleteAccountModal(false)}
          />
        )
      }
      {showUpdateEmail && (
        <EmailChangeModal
          show={showUpdateEmail}
          onClose={() => setShowUpdateEmail(false)}
          email={userProfile.email}
        />
      )}
    </>
  )
}
