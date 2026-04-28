'use client'

import { Button } from '@langgenius/dify-ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { toast } from '@langgenius/dify-ui/toast'
import {
  RiExternalLinkLine,
} from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import { useEducationDiscount } from '@/app/components/billing/hooks/use-education-discount'
import { Plan } from '@/app/components/billing/type'
import PlanBadge from '@/app/components/header/plan-badge'
import { EDUCATION_VERIFYING_LOCALSTORAGE_ITEM } from '@/app/education-apply/constants'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { useProviderContext } from '@/context/provider-context'
import { useWorkspacesContext } from '@/context/workspace-context'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import {
  useRouter,
  useSearchParams,
} from '@/next/navigation'
import { consoleClient } from '@/service/client'
import { switchWorkspace } from '@/service/common'
import {
  useEducationAdd,
  useInvalidateEducationStatus,
} from '@/service/use-education'
import DifyLogo from '../components/base/logo/dify-logo'
import RoleSelector from './role-selector'
import SearchInput from './search-input'
import UserInfo from './user-info'
import Confirm from './verify-state-modal'

const AppliedEducationCase = {
  eligible: 'eligible',
  activeSubscription: 'activeSubscription',
  noPaymentPermission: 'noPaymentPermission',
} as const

const EducationApplyAge = () => {
  const { t } = useTranslation()
  const [schoolName, setSchoolName] = useState('')
  const [role, setRole] = useState('Student')
  const [ageChecked, setAgeChecked] = useState(false)
  const [inSchoolChecked, setInSchoolChecked] = useState(false)
  const [isOpeningBillingPortal, setIsOpeningBillingPortal] = useState(false)
  const {
    isPending,
    mutateAsync: educationAdd,
  } = useEducationAdd({ onSuccess: noop })
  const [modalShow, setModalShow] = useState<undefined | { title: string, desc: string, confirmText?: string, onConfirm?: () => void }>(undefined)
  const { onPlanInfoChanged, isEducationAccount, plan } = useProviderContext()
  const { currentWorkspace } = useAppContext()
  const { workspaces } = useWorkspacesContext()
  const updateEducationStatus = useInvalidateEducationStatus()
  const docLink = useDocLink()
  const { handleEducationDiscount } = useEducationDiscount()
  const router = useRouter()
  const openAsyncWindow = useAsyncWindowOpen()

  const handleSuccessConfirm = async () => {
    setModalShow(undefined)
    onPlanInfoChanged()
    updateEducationStatus()
    localStorage.removeItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)
    await handleEducationDiscount()
  }

  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const appliedEducationCase = (() => {
    const value = searchParams.get('case')
    if (value === '2')
      return AppliedEducationCase.activeSubscription
    if (value === '3')
      return AppliedEducationCase.noPaymentPermission
    return AppliedEducationCase.eligible
  })()
  const handleSubmit = () => {
    educationAdd({
      token: token || '',
      role,
      institution: schoolName,
    }).then((res) => {
      if (res.message === 'success') {
        setModalShow({
          title: t('successTitle', { ns: 'education' }),
          desc: t('successContent', { ns: 'education' }),
          confirmText: t('useEducationDiscount', { ns: 'education' }),
          onConfirm: handleSuccessConfirm,
        })
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
  const handleSwitchWorkspace = async (tenantId: string) => {
    if (tenantId === currentWorkspace?.id)
      return

    try {
      await switchWorkspace({ url: '/workspaces/switch', body: { tenant_id: tenantId } })
      location.reload()
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
        <div className="system-md-regular text-text-secondary">
          <span>
            {t('applied.activeSubscription.description', { ns: 'education' })}
          </span>
          {' '}
          <button
            type="button"
            className="text-text-accent hover:underline disabled:cursor-not-allowed disabled:text-text-disabled"
            onClick={handleOpenBillingPortal}
            disabled={isOpeningBillingPortal}
          >
            {t('applied.activeSubscription.stripeLink', { ns: 'education' })}
          </button>
        </div>
      )
    }

    return (
      <div className="system-md-regular text-text-secondary">
        <span>
          {t('applied.noPaymentPermission.description', { ns: 'education' })}
        </span>
        {' '}
        <button
          type="button"
          className="text-text-accent hover:underline"
          onClick={handleReturnHome}
        >
          {t('applied.noPaymentPermission.returnHome', { ns: 'education' })}
        </button>
      </div>
    )
  }

  const renderAppliedEducationContent = () => {
    const currentWorkspaceInList = workspaces.find(workspace => workspace.current)
    const workspacePlan = Object.values(Plan).includes(currentWorkspaceInList?.plan as Plan)
      ? currentWorkspaceInList?.plan as Plan
      : Object.values(Plan).includes(plan.type as Plan)
        ? plan.type as Plan
        : Plan.sandbox
    const workspaceName = currentWorkspaceInList?.name || currentWorkspace?.name
    const workspaceId = currentWorkspaceInList?.id || currentWorkspace?.id

    return (
      <div className="flex w-full flex-col gap-4">
        <div className="rounded-lg border border-effects-highlight bg-background-default-subtle px-6">
          <div className="flex items-center gap-2">
            <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-components-icon-bg-blue-solid system-xs-semibold text-text-primary-on-surface">
              1
            </div>
            <div>
              <div className="system-lg-semibold text-text-secondary">
                {t('applied.step1.description', { ns: 'education' })}
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-lg px-6">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-components-icon-bg-blue-solid system-xs-semibold text-text-primary-on-surface">
              2
            </div>
            <div>
              <div className="system-lg-semibold text-text-secondary">
                {t('applied.step2.description', { ns: 'education' })}
              </div>
            </div>
          </div>
          <Select
            value={workspaceId ?? ''}
            onValueChange={(value) => {
              if (value)
                void handleSwitchWorkspace(value)
            }}
          >
            <SelectTrigger className="border-components-input-border h-14! w-full cursor-pointer justify-between rounded-lg border bg-background-default px-3! py-2! hover:bg-state-base-hover">
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-components-icon-bg-blue-solid text-[18px]">
                  <span className="bg-gradient-to-r from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text font-semibold text-shadow-shadow-1 uppercase opacity-90">
                    {workspaceName?.[0]?.toLocaleUpperCase()}
                  </span>
                </span>
                <span className="min-w-0 truncate system-md-semibold text-text-primary">{workspaceName}</span>
                <PlanBadge plan={workspacePlan} />
              </span>
            </SelectTrigger>
            <SelectContent popupClassName="w-[360px]">
              <SelectGroup>
                <SelectLabel>
                  {t('userProfile.workspace', { ns: 'common' })}
                </SelectLabel>
                {workspaces.map(workspace => (
                  <SelectItem key={workspace.id} value={workspace.id} className="h-12 gap-3 py-2 pr-3 pl-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-components-icon-bg-blue-solid text-[16px]">
                      <span className="h-8 bg-gradient-to-r from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text align-middle leading-8 font-semibold text-shadow-shadow-1 uppercase opacity-90">
                        {workspace.name[0]?.toLocaleUpperCase()}
                      </span>
                    </div>
                    <SelectItemText className="min-w-0 flex-1 truncate system-md-regular">
                      {workspace.name}
                    </SelectItemText>
                    <span className="ml-auto shrink-0">
                      <PlanBadge plan={workspace.plan as Plan} />
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div className="mt-5 border-t border-divider-subtle pt-4">
            {renderAppliedEducationAction()}
          </div>
        </div>
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
          {isEducationAccount
            ? (
                <div className="flex">
                  {renderAppliedEducationContent()}
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
                    <RiExternalLinkLine className="ml-1 h-3 w-3" />
                  </a>
                </>
              )}
        </div>
      </div>
      <Confirm
        isShow={!!modalShow}
        title={modalShow?.title || ''}
        content={modalShow?.desc}
        confirmText={modalShow?.confirmText}
        onConfirm={modalShow?.onConfirm || noop}
        onCancel={modalShow?.onConfirm || noop}
      />
    </div>
  )
}

export default EducationApplyAge

type AppliedEducationCase = typeof AppliedEducationCase[keyof typeof AppliedEducationCase]
