'use client'

import type {
  AccessPolicyWithBindings,
  ResourceOpenScope,
  ResourceUserAccessSetting,
} from '@/models/access-control'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useMemo } from 'react'
import { useTranslation } from '#i18n'
import Loading from '@/app/components/base/loading'
import AddAccessSubjectPopover from './add-access-subject-popover'
import { ACCESS_RULE_TABLE_GRID } from './constants'
import ResourceOpenScopeSection from './open-scope-section'
import TitleInfotip from './title-infotip'
import UserAccessPolicyRow from './user-access-policy-row'

export type AccessRulesEditorProps = {
  rules: AccessPolicyWithBindings[]
  userAccessSettings: ResourceUserAccessSetting[]
  isLoadingRules: boolean
  isLoadingUserAccessSettings: boolean
  openScope?: ResourceOpenScope
  isUpdatingOpenScope: boolean
  updatingAccountId: string | null
  maintainerId?: string | null
  className?: string
  onOpenScopeChange?: (openScope: ResourceOpenScope) => void
  onUserAccessPoliciesChange?: (accountId: string, accessPolicyIds: string[]) => void
  onRemoveAccessPolicyMemberBinding?: (accountId: string, accessPolicyId: string) => void
  onAddAccessSubject?: (accountId: string, accessPolicyIds: string[]) => void
}

export default function AccessRulesEditor({
  rules,
  userAccessSettings,
  isLoadingRules,
  isLoadingUserAccessSettings,
  openScope,
  isUpdatingOpenScope,
  updatingAccountId,
  maintainerId,
  className,
  onOpenScopeChange,
  onUserAccessPoliciesChange,
  onRemoveAccessPolicyMemberBinding,
  onAddAccessSubject,
}: AccessRulesEditorProps) {
  const { t } = useTranslation()
  const isLoading = isLoadingRules || isLoadingUserAccessSettings
  const individualPermissionSettingsTip = t('accessRule.individualPermissionSettingsTip', { ns: 'permission' })
  const policyOptions = useMemo(() => {
    return rules.map(rule => ({
      id: rule.policy.id,
      name: rule.policy.name,
    }))
  }, [rules])

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <ResourceOpenScopeSection
        value={openScope}
        disabled={isUpdatingOpenScope || !openScope}
        onChange={onOpenScopeChange}
      />
      <div className="flex min-h-8 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <h2 className="system-sm-semibold text-text-secondary">
            {t('accessRule.individualPermissionSettings', { ns: 'permission' })}
          </h2>
          <TitleInfotip content={individualPermissionSettingsTip} />
        </div>
        {onAddAccessSubject
          ? (
              <AddAccessSubjectPopover
                userAccessSettings={userAccessSettings}
                updatingAccountId={updatingAccountId}
                onAddAccessSubject={onAddAccessSubject}
              />
            )
          : (
              <Button
                variant="primary"
                size="medium"
                disabled
              >
                <span className="i-ri-add-line size-3.5" aria-hidden />
                <span>{t('operation.add', { ns: 'common' })}</span>
              </Button>
            )}
      </div>
      <section className="overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg">
        <div className={cn('grid items-center gap-4 border-b border-divider-deep px-10 py-4 system-sm-semibold text-text-tertiary', ACCESS_RULE_TABLE_GRID)}>
          <div>{t('accessRule.member', { ns: 'permission' })}</div>
          <div>{t('accessRule.permission', { ns: 'permission' })}</div>
          <div>{t('accessRule.actions', { ns: 'permission' })}</div>
        </div>
        {isLoading
          ? (
              <div className="px-4 py-8 text-center">
                <Loading type="app" />
              </div>
            )
          : userAccessSettings.length === 0
            ? (
                <div className="px-4 py-8 text-center system-sm-regular text-text-tertiary">
                  {t('accessRule.noUserAccessSettings', { ns: 'permission' })}
                </div>
              )
            : (
                <div className="px-4">
                  {userAccessSettings.map((setting, index) => (
                    <UserAccessPolicyRow
                      key={setting.account.account_id}
                      setting={setting}
                      policyOptions={policyOptions}
                      disabled={updatingAccountId === setting.account.account_id}
                      isMaintainer={maintainerId === setting.account.account_id}
                      className={cn(index > 0 && 'border-t border-divider-subtle')}
                      onChange={onUserAccessPoliciesChange}
                      onRemove={onRemoveAccessPolicyMemberBinding}
                    />
                  ))}
                </div>
              )}
      </section>
    </div>
  )
}
