'use client'

import type { ReactNode } from 'react'
import type { Plan as PlanType } from '@/app/components/billing/type'
import type { ICurrentWorkspace } from '@/models/common'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { noop } from 'es-toolkit/function'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import { useEducationDiscount } from '@/app/components/billing/hooks/use-education-discount'
import { Plan } from '@/app/components/billing/type'
import { EDUCATION_VERIFYING_LOCALSTORAGE_ITEM } from '@/app/education-apply/constants'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { useProviderContext } from '@/context/provider-context'
import { useWorkspacesContext } from '@/context/workspace-context'
import { WorkspaceProvider } from '@/context/workspace-context-provider'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import {
  useRouter,
  useSearchParams,
} from '@/next/navigation'
import { consoleClient } from '@/service/client'
import { switchWorkspace } from '@/service/common'
import { commonQueryKeys } from '@/service/use-common'
import {
  useEducationAdd,
  useInvalidateEducationStatus,
} from '@/service/use-education'
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
  const { currentWorkspace, isCurrentWorkspaceManager } = useAppContext()
  const updateEducationStatus = useInvalidateEducationStatus()
  const docLink = useDocLink()
  const { handleEducationDiscount } = useEducationDiscount()
  const router = useRouter()
  const openAsyncWindow = useAsyncWindowOpen()
  const queryClient = useQueryClient()

  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const appliedEducationCase = (() => {
    if (!isCurrentWorkspaceManager)
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
        localStorage.removeItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)
        setHasSubmittedEducation(true)
      }
      else {
        toast.error(t('submitError', { ns: 'education' }))
      }
    })
  }
  const handleOpenBillingPortal = async () => {
    if (isOpeningBillingPortal)
      return

    setIsOpeningBillingPortal(true)
    try {
      await openAsyncWindow(async () => {
        const res = await consoleClient.billing.invoices()
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
      <span className="mr-1 i-ri-arrow-left-line h-4 w-4" />
      {t('applied.noPaymentPermission.returnHome', { ns: 'education' })}
    </Button>
  )
  const handleSwitchWorkspace = async (tenantId: string) => {
    if (tenantId === currentWorkspace?.id)
      return

    try {
      await switchWorkspace({ url: '/workspaces/switch', body: { tenant_id: tenantId } })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: commonQueryKeys.currentWorkspace }),
        queryClient.invalidateQueries({ queryKey: commonQueryKeys.workspaces }),
      ])
      onPlanInfoChanged()
      updateEducationStatus()
    }
    catch {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
    }
  }

  const renderAppliedEducationAction = () => {
    if (appliedEducationCase === AppliedEducationCase.eligible) {
      return (
        <Button variant="primary" onClick={handleEducationDiscount}>
          {t('useEducationDiscount', { ns: 'education' })}
        </Button>
      )
    }

    if (appliedEducationCase === AppliedEducationCase.activeSubscription) {
      return (
        <div className="flex w-full flex-col items-start gap-3">
          <div className="flex w-full items-start rounded-lg border-[0.5px] border-components-badge-status-light-warning-halo bg-state-warning-hover px-3 py-2.5">
            <span className="mt-0.5 mr-2 i-ri-alert-fill h-4 w-4 shrink-0 text-text-warning-secondary" />
            <div className="system-md-regular text-text-warning">
              <Trans
                i18nKey="applied.activeSubscription.description"
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
          <span className="mt-0.5 mr-2 i-ri-alert-fill h-4 w-4 shrink-0 text-text-warning-secondary" />
          <div className="system-md-regular text-text-warning">
            {t('applied.noPaymentPermission.description', { ns: 'education' })}
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
            <div className="mb-2 title-5xl-bold shadow-xs">{t('toVerified', { ns: 'education' })}</div>
            <div className="system-md-medium shadow-xs">
              {t('toVerifiedTip.front', { ns: 'education' })}
              &nbsp;
              <span className="system-md-semibold underline">{t('toVerifiedTip.coupon', { ns: 'education' })}</span>
              &nbsp;
              {t('toVerifiedTip.end', { ns: 'education' })}
            </div>
          </div>
          <div className="mb-7">
            <UserInfo />
          </div>
          {isEducationAccount || hasSubmittedEducation
            ? (
                <div className="flex">
                  <AppliedEducationWorkspaceBlock
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
                      {t('form.schoolName.title', { ns: 'education' })}
                    </div>
                    <SearchInput
                      value={schoolName}
                      onChange={setSchoolName}
                    />
                  </div>
                  <div className="mb-7">
                    <div className="mb-1 flex h-6 items-center system-md-semibold text-text-secondary">
                      {t('form.schoolRole.title', { ns: 'education' })}
                    </div>
                    <RoleSelector
                      value={role}
                      onChange={setRole}
                    />
                  </div>
                  <div className="mb-7">
                    <div className="mb-1 flex h-6 items-center system-md-semibold text-text-secondary">
                      {t('form.terms.title', { ns: 'education' })}
                    </div>
                    <div className="mb-1 system-md-regular text-text-tertiary">
                      {t('form.terms.desc.front', { ns: 'education' })}
                      &nbsp;
                      <a href="https://dify.ai/terms" target="_blank" className="text-text-secondary hover:underline">{t('form.terms.desc.termsOfService', { ns: 'education' })}</a>
                      &nbsp;
                      {t('form.terms.desc.and', { ns: 'education' })}
                      &nbsp;
                      <a href="https://dify.ai/privacy" target="_blank" className="text-text-secondary hover:underline">{t('form.terms.desc.privacyPolicy', { ns: 'education' })}</a>
                      {t('form.terms.desc.end', { ns: 'education' })}
                    </div>
                    <div className="py-2 system-md-regular text-text-primary">
                      <div className="mb-2 flex">
                        <Checkbox
                          className="mr-2 shrink-0"
                          checked={ageChecked}
                          onCheck={() => setAgeChecked(!ageChecked)}
                        />
                        {t('form.terms.option.age', { ns: 'education' })}
                      </div>
                      <div className="flex">
                        <Checkbox
                          className="mr-2 shrink-0"
                          checked={inSchoolChecked}
                          onCheck={() => setInSchoolChecked(!inSchoolChecked)}
                        />
                        {t('form.terms.option.inSchool', { ns: 'education' })}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    disabled={!ageChecked || !inSchoolChecked || !schoolName || !role || isPending}
                    onClick={handleSubmit}
                  >
                    {t('submit', { ns: 'education' })}
                  </Button>
                  <div className="mt-5 mb-4 h-px bg-linear-to-r from-[rgba(16,24,40,0.08)]"></div>
                  <a
                    className="flex items-center system-xs-regular text-text-accent"
                    href={docLink('/use-dify/workspace/subscription-management#dify-for-education')}
                    target="_blank"
                  >
                    {t('learn', { ns: 'education' })}
                    <span className="ml-1 i-ri-external-link-line h-3 w-3" />
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
  const { workspaces } = useWorkspacesContext()

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

function AppliedEducationWorkspaceBlock(props: AppliedEducationWorkspaceBlockProps) {
  return (
    <WorkspaceProvider>
      <AppliedEducationWorkspaceContent {...props} />
    </WorkspaceProvider>
  )
}

const EducationApplyAge = () => <EducationApplyAgeContent />

export default EducationApplyAge

type AppliedEducationCase = typeof AppliedEducationCase[keyof typeof AppliedEducationCase]
