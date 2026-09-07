'use client'
import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { IItem } from '@/app/components/header/account-setting/collapse'
import { zIconType } from '@dify/contracts/api/console/apps/zod.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { toast } from '@langgenius/dify-ui/toast'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import PremiumBadge from '@/app/components/base/premium-badge'
import Collapse from '@/app/components/header/account-setting/collapse'
import { validPassword } from '@/config'
import { useProviderContext } from '@/context/provider-context'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/client'
import { updateUserProfile } from '@/service/common'
import DeleteAccount from '../delete-account'
import AvatarWithEdit from './AvatarWithEdit'
import EmailChangeModal from './email-change-modal'

const titleClassName = `
  system-sm-semibold text-text-secondary
`
const descriptionClassName = `
  mt-1 body-xs-regular text-text-tertiary
`
type AccountAppItem = AppPartial & IItem

export default function AccountPage() {
  const { t } = useTranslation()
  const editNameInputId = useId()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: appList } = useQuery(
    consoleQuery.apps.get.queryOptions({
      input: {
        query: {
          page: 1,
          limit: 100,
          name: '',
        },
      },
    }),
  )
  const apps = appList?.data || []
  const queryClient = useQueryClient()
  // Cache is hydrated by CommonLayoutHydrationBoundary; this hits cache synchronously.
  const { data: userProfileResp } = useSuspenseQuery(userProfileQueryOptions())
  const userProfile = userProfileResp.profile
  const mutateUserProfile = () =>
    queryClient.invalidateQueries({ queryKey: userProfileQueryOptions().queryKey })
  const { enableEducationPlan } = useProviderContext()
  const { data: isEducationAccount = false } = useQuery(
    consoleQuery.account.education.get.queryOptions({
      enabled: enableEducationPlan,
      select: ({ is_student }) => is_student ?? false,
    }),
  )
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

  if (!userProfile) return null

  const handleEditName = () => {
    setEditNameModalVisible(true)
    setEditName(userProfile.name)
  }
  const handleSaveName = async () => {
    try {
      setEditing(true)
      await updateUserProfile({ url: 'account/name', body: { name: editName } })
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      mutateUserProfile()
      setEditNameModalVisible(false)
      setEditing(false)
    } catch (e) {
      toast.error((e as Error).message)
      setEditing(false)
    }
  }

  const showErrorMessage = (message: string) => {
    toast.error(message)
  }
  const valid = () => {
    if (!password.trim()) {
      showErrorMessage(t(($) => $['error.passwordEmpty'], { ns: 'login' }))
      return false
    }
    if (!validPassword.test(password)) {
      showErrorMessage(t(($) => $['error.passwordInvalid'], { ns: 'login' }))
      return false
    }
    if (password !== confirmPassword) {
      showErrorMessage(t(($) => $['account.notEqual'], { ns: 'common' }))
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
    if (!valid()) return
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
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      mutateUserProfile()
      setEditPasswordModalVisible(false)
      resetPasswordForm()
      setEditing(false)
    } catch (e) {
      toast.error((e as Error).message)
      setEditPasswordModalVisible(false)
      setEditing(false)
    }
  }

  const renderAppItem = (item: AccountAppItem) => {
    const appIconType = zIconType.safeParse(item.icon_type).data ?? null
    return (
      <div className="flex px-3 py-1">
        <div className="mr-3">
          <AppIcon
            size="tiny"
            iconType={appIconType}
            icon={item.icon ?? undefined}
            background={item.icon_background}
            imageUrl={item.icon_url}
          />
        </div>
        <div className="mt-0.75 system-sm-medium text-text-secondary">{item.name}</div>
      </div>
    )
  }

  return (
    <>
      <div className="pt-2 pb-3">
        <h4 className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['account.myAccount'], { ns: 'common' })}
        </h4>
      </div>
      <div className="mb-8 flex items-center rounded-xl bg-linear-to-r from-background-gradient-bg-fill-chat-bg-2 to-background-gradient-bg-fill-chat-bg-1 p-6">
        <AvatarWithEdit
          avatar={userProfile.avatar_url}
          name={userProfile.name}
          onSave={mutateUserProfile}
          size="3xl"
        />
        <div className="ml-4">
          <p className="system-xl-semibold text-text-primary">
            {userProfile.name}
            {isEducationAccount && (
              <PremiumBadge size="s" color="blue" className="ml-1 px-2!">
                <span aria-hidden className="mr-1 i-ri-graduation-cap-fill size-3" />
                <span className="system-2xs-medium">EDU</span>
              </PremiumBadge>
            )}
          </p>
          <p className="system-xs-regular text-text-tertiary">{userProfile.email}</p>
        </div>
      </div>
      <div className="mb-8">
        <div className={titleClassName}>{t(($) => $['account.name'], { ns: 'common' })}</div>
        <div className="mt-2 flex w-full items-center justify-between gap-2">
          <div className="flex-1 rounded-lg bg-components-input-bg-normal p-2 system-sm-regular text-components-input-text-filled">
            <span className="pl-1">{userProfile.name}</span>
          </div>
          <button
            type="button"
            className="cursor-pointer rounded-lg bg-components-button-tertiary-bg px-3 py-2 system-sm-medium text-components-button-tertiary-text"
            onClick={handleEditName}
          >
            {t(($) => $['operation.edit'], { ns: 'common' })}
          </button>
        </div>
      </div>
      <div className="mb-8">
        <div className={titleClassName}>{t(($) => $['account.email'], { ns: 'common' })}</div>
        <div className="mt-2 flex w-full items-center justify-between gap-2">
          <div className="flex-1 rounded-lg bg-components-input-bg-normal p-2 system-sm-regular text-components-input-text-filled">
            <span className="pl-1">{userProfile.email}</span>
          </div>
          {systemFeatures.enable_change_email && (
            <button
              type="button"
              className="cursor-pointer rounded-lg bg-components-button-tertiary-bg px-3 py-2 system-sm-medium text-components-button-tertiary-text"
              onClick={() => setShowUpdateEmail(true)}
            >
              {t(($) => $['operation.change'], { ns: 'common' })}
            </button>
          )}
        </div>
      </div>
      {systemFeatures.enable_email_password_login && (
        <div className="mb-8 flex justify-between gap-2">
          <div>
            <div className="mb-1 system-sm-semibold text-text-secondary">
              {t(($) => $['account.password'], { ns: 'common' })}
            </div>
            <div className="mb-2 body-xs-regular text-text-tertiary">
              {t(($) => $['account.passwordTip'], { ns: 'common' })}
            </div>
          </div>
          <Button onClick={() => setEditPasswordModalVisible(true)}>
            {userProfile.is_password_set
              ? t(($) => $['account.resetPassword'], { ns: 'common' })
              : t(($) => $['account.setPassword'], { ns: 'common' })}
          </Button>
        </div>
      )}
      <div className="mb-6 border border-divider-subtle" />
      <div className="mb-8">
        <div className={titleClassName}>
          {t(($) => $['account.langGeniusAccount'], { ns: 'common' })}
        </div>
        <div className={descriptionClassName}>
          {t(($) => $['account.langGeniusAccountTip'], { ns: 'common' })}
        </div>
        {!!apps.length && (
          <Collapse
            title={`${t(($) => $['account.showAppLength'], { ns: 'common', length: apps.length })}`}
            items={apps.map((app) => ({ ...app, key: app.id, name: app.name }))}
            renderItem={renderAppItem}
            wrapperClassName="mt-2"
          />
        )}
        {systemFeatures.deployment_edition === 'CLOUD' && (
          <Button
            className="mt-2 text-components-button-destructive-secondary-text"
            onClick={() => setShowDeleteAccountModal(true)}
          >
            {t(($) => $['account.delete'], { ns: 'common' })}
          </Button>
        )}
      </div>
      <Dialog
        open={editNameModalVisible}
        onOpenChange={(open) => !open && setEditNameModalVisible(false)}
      >
        <DialogContent className="w-105 p-6">
          <div className="mb-6 title-2xl-semi-bold text-text-primary">
            {t(($) => $['account.editName'], { ns: 'common' })}
          </div>
          <label htmlFor={editNameInputId} className={`block ${titleClassName}`}>
            {t(($) => $['account.name'], { ns: 'common' })}
          </label>
          <Input
            id={editNameInputId}
            className="mt-2"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
          <div className="mt-10 flex justify-end">
            <Button className="mr-2" onClick={() => setEditNameModalVisible(false)}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
            <Button disabled={editing || !editName} variant="primary" onClick={handleSaveName}>
              {t(($) => $['operation.save'], { ns: 'common' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={editPasswordModalVisible}
        onOpenChange={(open) => !open && (setEditPasswordModalVisible(false), resetPasswordForm())}
      >
        <DialogContent className="w-105! p-6!">
          <div className="mb-6 title-2xl-semi-bold text-text-primary">
            {userProfile.is_password_set
              ? t(($) => $['account.resetPassword'], { ns: 'common' })
              : t(($) => $['account.setPassword'], { ns: 'common' })}
          </div>
          {userProfile.is_password_set && (
            <Field name="current-password" className="gap-0">
              <FieldLabel className="py-0 system-sm-semibold text-text-secondary">
                {t(($) => $['account.currentPassword'], { ns: 'common' })}
              </FieldLabel>
              <InputGroup className="mt-2">
                <InputGroupInput
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onValueChange={setCurrentPassword}
                  autoComplete="current-password"
                  spellCheck={false}
                />
                <InputGroupAddon align="inline-end">
                  <IconButton
                    size="lg"
                    aria-label={t(($) => $[showCurrentPassword ? 'hidePassword' : 'showPassword'], {
                      ns: 'login',
                    })}
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  >
                    <span aria-hidden="true">{showCurrentPassword ? '👀' : '😝'}</span>
                  </IconButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          )}
          <Field name="new-password" className="mt-8 gap-0">
            <FieldLabel className="py-0 system-sm-semibold text-text-secondary">
              {userProfile.is_password_set
                ? t(($) => $['account.newPassword'], { ns: 'common' })
                : t(($) => $['account.password'], { ns: 'common' })}
            </FieldLabel>
            <InputGroup className="mt-2">
              <InputGroupInput
                type={showPassword ? 'text' : 'password'}
                value={password}
                onValueChange={setPassword}
                autoComplete="new-password"
                spellCheck={false}
              />
              <InputGroupAddon align="inline-end">
                <IconButton
                  size="lg"
                  aria-label={t(($) => $[showPassword ? 'hidePassword' : 'showPassword'], {
                    ns: 'login',
                  })}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  <span aria-hidden="true">{showPassword ? '👀' : '😝'}</span>
                </IconButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>
          <Field name="confirm-password" className="mt-8 gap-0">
            <FieldLabel className="py-0 system-sm-semibold text-text-secondary">
              {t(($) => $['account.confirmPassword'], { ns: 'common' })}
            </FieldLabel>
            <InputGroup className="mt-2">
              <InputGroupInput
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onValueChange={setConfirmPassword}
                autoComplete="new-password"
                spellCheck={false}
              />
              <InputGroupAddon align="inline-end">
                <IconButton
                  size="lg"
                  aria-label={t(($) => $[showConfirmPassword ? 'hidePassword' : 'showPassword'], {
                    ns: 'login',
                  })}
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  <span aria-hidden="true">{showConfirmPassword ? '👀' : '😝'}</span>
                </IconButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>
          <div className="mt-10 flex justify-end">
            <Button
              className="mr-2"
              onClick={() => {
                setEditPasswordModalVisible(false)
                resetPasswordForm()
              }}
            >
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>
            <Button disabled={editing} variant="primary" onClick={handleSavePassword}>
              {userProfile.is_password_set
                ? t(($) => $['operation.reset'], { ns: 'common' })
                : t(($) => $['operation.save'], { ns: 'common' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {showDeleteAccountModal && (
        <DeleteAccount
          onCancel={() => setShowDeleteAccountModal(false)}
          onConfirm={() => setShowDeleteAccountModal(false)}
        />
      )}
      {/* Use conditional JSX instead of a mounted controlled Dialog so closing destroys the email-change form session. */}
      {showUpdateEmail ? (
        <EmailChangeModal onClose={() => setShowUpdateEmail(false)} email={userProfile.email} />
      ) : null}
    </>
  )
}
