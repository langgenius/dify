'use client'
import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { IItem } from '@/app/components/header/account-setting/collapse'
import { zIconType } from '@dify/contracts/api/console/apps/zod.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import PremiumBadge from '@/app/components/base/premium-badge'
import Collapse from '@/app/components/header/account-setting/collapse'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'
import DeleteAccount from '../delete-account'
import AvatarWithEdit from './AvatarWithEdit'
import { ChangePasswordDialog } from './change-password-dialog'
import { EditAccountNameDialog } from './edit-account-name-dialog'
import EmailChangeModal from './email-change-modal'

const titleClassName = `
  system-sm-semibold text-text-secondary
`
const descriptionClassName = `
  mt-1 body-xs-regular text-text-tertiary
`
type AccountAppItem = AppPartial & IItem

export default function AccountPage() {
  const { t } = useTranslation(['common', 'accountSettings'])
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
  // Cache is hydrated by CommonLayoutHydrationBoundary; this hits cache synchronously.
  const { data: userProfileResp } = useSuspenseQuery(userProfileQueryOptions())
  const userProfile = userProfileResp.profile
  const { data: enableEducationPlan } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features) => features.education.enabled,
    }),
  )
  const { data: isEducationAccount = false } = useQuery(
    consoleQuery.account.education.get.queryOptions({
      enabled: enableEducationPlan === true,
      select: ({ is_student }) => is_student ?? false,
    }),
  )
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false)
  const [showUpdateEmail, setShowUpdateEmail] = useState(false)

  if (!userProfile) return null

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
          {t(($) => $['account.myAccount'], { ns: 'accountSettings' })}
        </h4>
      </div>
      <div className="mb-8 flex items-center rounded-xl bg-linear-to-r from-background-gradient-bg-fill-chat-bg-2 to-background-gradient-bg-fill-chat-bg-1 p-6">
        <AvatarWithEdit avatar={userProfile.avatar_url} name={userProfile.name} size="3xl" />
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
        <div className={titleClassName}>
          {t(($) => $['account.name'], { ns: 'accountSettings' })}
        </div>
        <div className="mt-2 flex w-full items-center justify-between gap-2">
          <div className="flex-1 rounded-lg bg-components-input-bg-normal p-2 system-sm-regular text-components-input-text-filled">
            <span className="pl-1">{userProfile.name}</span>
          </div>
          <EditAccountNameDialog name={userProfile.name} />
        </div>
      </div>
      <div className="mb-8">
        <div className={titleClassName}>
          {t(($) => $['account.email'], { ns: 'accountSettings' })}
        </div>
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
              {t(($) => $['account.password'], { ns: 'accountSettings' })}
            </div>
            <div className="mb-2 body-xs-regular text-text-tertiary">
              {t(($) => $['account.passwordTip'], { ns: 'accountSettings' })}
            </div>
          </div>
          <ChangePasswordDialog isPasswordSet={userProfile.is_password_set} />
        </div>
      )}
      <div className="mb-6 border border-divider-subtle" />
      <div className="mb-8">
        <div className={titleClassName}>
          {t(($) => $['account.langGeniusAccount'], { ns: 'accountSettings' })}
        </div>
        <div className={descriptionClassName}>
          {t(($) => $['account.langGeniusAccountTip'], { ns: 'accountSettings' })}
        </div>
        {!!apps.length && (
          <Collapse
            title={`${t(($) => $['account.showAppLength'], { ns: 'accountSettings', length: apps.length })}`}
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
            {t(($) => $['account.delete'], { ns: 'accountSettings' })}
          </Button>
        )}
      </div>
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
