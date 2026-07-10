'use client'

import type { ReactNode } from 'react'
import type { Plan as PlanType } from '@/app/components/billing/type'
import type { ICurrentWorkspace } from '@/models/common'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { noop } from 'es-toolkit/function'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useEducationDiscount } from '@/app/components/billing/hooks/use-education-discount'
import { Plan } from '@/app/components/billing/type'
import { useSetEducationVerifying } from '@/app/education-apply/storage'
import { useDocLink } from '@/context/i18n'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useProviderContext } from '@/context/provider-context'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import {
  useRouter,
  useSearchParams,
} from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import {
  useEducationAdd,
  useInvalidateEducationStatus,
} from '@/service/use-education'
import { BillingPermission, hasPermission } from '@/utils/permission'
import DifyLogo from '../components/base/logo/dify-logo'
import AppliedEducationContent from './applied-education-content'
import RoleSelector from './role-selector'
import SearchInput from './search-input'
import UserInfo from './user-info'

const AppliedEducationCase = {
  eligible: 'eligible',
  activeSubscription: 'activeSubscription',
  noPaymentPermission: 'noPaymentPermission',
} as const

const EducationApplyAgeContent = () => {
  const { t } = useTranslation()
  const [schoolName, setSchoolName] = useState('')
  const [role, setRole] = useState('Student')
  const [ageChecked, setAgeChecked] = useState(false)
  const [inSchoolChecked, setInSchoolChecked] = useState(false)
  const [hasSubmittedEducation, setHasSubmittedEducation] = useState(false)
  const [isOpeningBillingPortal, setIsOpeningBillingPortal] = useState(false)
  const {
    isPending,
    mutateAsync: educationAdd,
  } = useEducationAdd({ onSuccess: noop })
  const { onPlanInfoChanged, isEducationAccount, plan } = useProviderContext()
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const updateEducationStatus = useInvalidateEducationStatus()
  const docLink = useDocLink()
  const { handleEducationDiscount } = useEducationDiscount()
  const router = useRouter()
  const openAsyncWindow = useAsyncWindowOpen()
  const queryClient = useQueryClient()
  const switchWorkspaceMutation = useMutation(consoleQuery.workspaces.switch.post.mutationOptions())
  const setEducationVerifying = useSetEducationVerifying()

  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const canManageBilling = hasPermission(workspacePermissionKeys, BillingPermission.Manage)
  const appliedEducationCase = (() => {
    if (!canManageBilling)
      return AppliedEducationCase.noPaymentPermission

    if (plan.type === Plan.sandbox)
      return AppliedEducationCase.eligible

    return AppliedEducationCase.activeSubscription
  })()
  const handleSubmit = () => {
    educationAdd({
      token: token || '',
      role,
      institution: schoolName,
    }).then((res) => {
      if (res.message === 'success') {
        onPlanInfoChanged()
        updateEducationStatus()
        setEducationVerifying(null)
        setHasSubmittedEducation(true)
      }
      else {
        toast.error(t($ => $['submitError'], { ns: 'education' }))
      }
    })
  }
  const handleOpenBillingPortal = async () => {
    if (isOpeningBillingPortal)
      return

    setIsOpeningBillingPortal(true)
    try {
      await openAsyncWindow(async () => {
        const res = await consoleClient.billing.invoices.get()
        if (res.url)
          return res.url

        throw new Error('Failed to open billing page')
      }, {
        onError: (err) => {
          toast.error(err.message || String(err))
        },
      })
    }
    finally {
      setIsOpeningBillingPortal(false)
    }
  }
  const handleReturnHome = () => {
    router.push('/')
  }
  const renderBackToDifyButton = () => (
    <Button variant="ghost-accent" onClick={handleReturnHome}>
      <span className="mr-1 i-ri-arrow-left-line size-4" />
      {t($ => $['applied.noPaymentPermission.returnHome'], { ns: 'education' })}
    </Button>
  )
  const handleSwitchWorkspace = async (tenantId: string) => {
    if (tenantId === currentWorkspace?.id)
      return

    try {
      await switchWorkspaceMutation.mutateAsync({ body: { tenant_id: tenantId } })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: consoleQuery.workspaces.current.post.key() }),
        queryClient.invalidateQueries({ queryKey: consoleQuery.workspaces.get.queryKey() }),
      ])
      onPlanInfoChanged()
      updateEducationStatus()
    }
    catch {
      toast.error(t($ => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
    }
  }

  const renderAppliedEducationAction = () => {
    if (appliedEducationCase === AppliedEducationCase.eligible) {
      return (
        <Button variant="primary" onClick={handleEducationDiscount}>
          {t($ => $['useEducationDiscount'], { ns: 'education' })}
        </Button>
      )
    }

    if (appliedEducationCase === AppliedEducationCase.activeSubscription) {
      return (
        <div className="flex w-full flex-col items-start gap-3">
          <div className="flex w-full items-start rounded-lg border-[0.5px] border-components-badge-status-light-warning-halo bg-state-warning-hover px-3 py-2.5">
            <span className="mt-0.5 mr-2 i-ri-alert-fill size-4 shrink-0 text-text-warning-secondary" />
            <div className="system-md-regular text-text-warning">
              <Trans
                i18nKey={$ => $["applied.activeSubscription.description"]}
                ns="education"
                components={{
                  stripeLink: (
                    <button
                      type="button"
                      className="text-text-accent hover:underline disabled:cursor-not-allowed disabled:text-text-disabled"
                      onClick={handleOpenBillingPortal}
                      disabled={isOpeningBillingPortal}
                    />
                  ),
                }}
              />
            </div>
          </div>
          {renderBackToDifyButton()}
        </div>
      )
    }

    return (
      <div className="flex w-full flex-col items-start gap-3">
        <div className="flex w-full items-start rounded-lg border-[0.5px] border-components-badge-status-light-warning-halo bg-state-warning-hover px-3 py-2.5">
          <span className="mt-0.5 mr-2 i-ri-alert-fill size-4 shrink-0 text-text-warning-secondary" />
          <div className="system-md-regular text-text-warning">
            {t($ => $['applied.noPaymentPermission.description'], { ns: 'education' })}
          </div>
        </div>
        {renderBackToDifyButton()}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-31 overflow-y-auto bg-background-body p-6">
      <div className="mx-auto w-full max-w-[1408px] rounded-2xl border border-effects-highlight bg-background-default-subtle">
        <div
          className="h-[349px] w-full overflow-hidden rounded-t-2xl bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: 'url(/education/bg.png)',
          }}
        >
        </div>
        <div className="mt-[-349px] box-content flex h-7 items-center justify-between p-6">
          <DifyLogo size="large" style="monochromeWhite" />
        </div>
        <div className="mx-auto max-w-[720px] px-8 pb-[180px]">
          <div className="mb-2 flex h-[192px] flex-col justify-end pt-3 pb-4 text-text-primary-on-surface">
            <div className="mb-2 title-5xl-bold shadow-xs">{t($ => $['toVerified'], { ns: 'education' })}</div>
            <div className="system-md-medium shadow-xs">
              {t($ => $['toVerifiedTip.front'], { ns: 'education' })}
              &nbsp;
              <span className="system-md-semibold underline">{t($ => $['toVerifiedTip.coupon'], { ns: 'education' })}</span>
              &nbsp;
              {t($ => $['toVerifiedTip.end'], { ns: 'education' })}
            </div>
          </div>
          <div className="mb-7">
            <UserInfo />
          </div>
          {isEducationAccount || hasSubmittedEducation
            ? (
                <div className="flex">
                  <AppliedEducationWorkspaceContent
                    currentWorkspace={currentWorkspace}
                    plan={plan.type}
                    action={renderAppliedEducationAction()}
                    onSwitchWorkspace={(value) => {
                      void handleSwitchWorkspace(value)
                    }}
                  />
                </div>
              )
            : (
                <>
                  <div className="mb-7">
                    <div className="mb-1 flex h-6 items-center system-md-semibold text-text-secondary">
                      {t($ => $['form.schoolName.title'], { ns: 'education' })}
                    </div>
                    <SearchInput
                      value={schoolName}
                      onChange={setSchoolName}
                    />
                  </div>
                  <div className="mb-7">
                    <div className="mb-1 flex h-6 items-center system-md-semibold text-text-secondary">
                      {t($ => $['form.schoolRole.title'], { ns: 'education' })}
                    </div>
                    <RoleSelector
                      value={role}
                      onChange={setRole}
                    />
                  </div>
                  <div className="mb-7">
                    <div className="mb-1 flex h-6 items-center system-md-semibold text-text-secondary">
                      {t($ => $['form.terms.title'], { ns: 'education' })}
                    </div>
                    <div className="mb-1 system-md-regular text-text-tertiary">
                      {t($ => $['form.terms.desc.front'], { ns: 'education' })}
                      &nbsp;
                      <a href="https://dify.ai/terms" target="_blank" className="text-text-secondary hover:underline">{t($ => $['form.terms.desc.termsOfService'], { ns: 'education' })}</a>
                      &nbsp;
                      {t($ => $['form.terms.desc.and'], { ns: 'education' })}
                      &nbsp;
                      <a href="https://dify.ai/privacy" target="_blank" className="text-text-secondary hover:underline">{t($ => $['form.terms.desc.privacyPolicy'], { ns: 'education' })}</a>
                      {t($ => $['form.terms.desc.end'], { ns: 'education' })}
                    </div>
                    <div className="py-2 system-md-regular text-text-primary">
                      <label className="mb-2 flex">
                        <Checkbox
                          className="mr-2 shrink-0"
                          checked={ageChecked}
                          onCheckedChange={setAgeChecked}
                        />
                        {t($ => $['form.terms.option.age'], { ns: 'education' })}
                      </label>
                      <label className="flex">
                        <Checkbox
                          className="mr-2 shrink-0"
                          checked={inSchoolChecked}
                          onCheckedChange={setInSchoolChecked}
                        />
                        {t($ => $['form.terms.option.inSchool'], { ns: 'education' })}
                      </label>
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    disabled={!ageChecked || !inSchoolChecked || !schoolName || !role || isPending}
                    onClick={handleSubmit}
                  >
                    {t($ => $['submit'], { ns: 'education' })}
                  </Button>
                  <div className="mt-5 mb-4 h-px bg-linear-to-r from-[rgba(16,24,40,0.08)]"></div>
                  <a
                    className="flex items-center system-xs-regular text-text-accent"
                    href={docLink('/use-dify/workspace/subscription-management#dify-for-education')}
                    target="_blank"
                  >
                    {t($ => $['learn'], { ns: 'education' })}
                    <span className="ml-1 i-ri-external-link-line size-3" />
                  </a>
                </>
              )}
        </div>
      </div>
    </div>
  )
}

type AppliedEducationWorkspaceBlockProps = {
  currentWorkspace: ICurrentWorkspace
  plan: PlanType
  action: ReactNode
  onSwitchWorkspace: (tenantId: string) => void
}

function AppliedEducationWorkspaceContent({
  currentWorkspace,
  plan,
  action,
  onSwitchWorkspace,
}: AppliedEducationWorkspaceBlockProps) {
  const { data: workspacesData } = useQuery(consoleQuery.workspaces.get.queryOptions())
  const workspaces = workspacesData?.workspaces ?? []

  return (
    <AppliedEducationContent
      workspaces={workspaces}
      currentWorkspace={currentWorkspace}
      plan={plan}
      action={action}
      onSwitchWorkspace={onSwitchWorkspace}
    />
  )
}

const EducationApplyAge = () => <EducationApplyAgeContent />

export default EducationApplyAge

type AppliedEducationCase = typeof AppliedEducationCase[keyof typeof AppliedEducationCase]
