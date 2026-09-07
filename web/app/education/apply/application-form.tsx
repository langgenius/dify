'use client'

import type { SubscriptionModel } from '@dify/contracts/api/console/features/types.gen'
import type { GetWorkspacesCurrentSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import type { EducationRole } from './types'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { Field, FieldDescription, FieldItem, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Form } from '@langgenius/dify-ui/form'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useEducationDiscount } from '@/app/components/billing/hooks/use-education-discount'
import { useDocLink } from '@/context/i18n'
import { currentWorkspaceAtom, isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import Link from '@/next/link'
import { consoleClient, consoleQuery } from '@/service/client'
import UserInfo from '../user-info'
import AppliedEducationContent from './applied-education-content'
import InstitutionField from './institution-field'
import RoleSelector from './role-selector'

const REQUIRED_AGREEMENTS = ['age', 'inSchool', 'personalUse']

const AppliedEducationCase = {
  eligible: 'eligible',
  activeSubscription: 'activeSubscription',
  noPaymentPermission: 'noPaymentPermission',
} as const

type EducationApplyPageProps = {
  plan: SubscriptionModel['plan']
  token: string
}

const EducationApplyPage = ({ plan, token }: EducationApplyPageProps) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [schoolName, setSchoolName] = useState('')
  const [role, setRole] = useState<EducationRole>('Student')
  const [agreements, setAgreements] = useState<string[]>([])
  const [hasSubmittedEducation, setHasSubmittedEducation] = useState(false)
  const [isOpeningBillingPortal, setIsOpeningBillingPortal] = useState(false)
  const { isPending, mutate: educationAdd } = useMutation(
    consoleQuery.account.education.post.mutationOptions(),
  )
  const { data: isEducationAccount = false } = useQuery(
    consoleQuery.account.education.get.queryOptions({
      select: ({ is_student }) => is_student ?? false,
    }),
  )
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const isCurrentWorkspaceManager = useAtomValue(isCurrentWorkspaceManagerAtom)
  const docLink = useDocLink()
  const { handleEducationDiscount } = useEducationDiscount()
  const openAsyncWindow = useAsyncWindowOpen()
  const switchWorkspaceMutation = useMutation(consoleQuery.workspaces.switch.post.mutationOptions())

  const appliedEducationCase = (() => {
    if (!isCurrentWorkspaceManager) return AppliedEducationCase.noPaymentPermission

    if (plan === 'sandbox') return AppliedEducationCase.eligible

    return AppliedEducationCase.activeSubscription
  })()
  const handleSubmit = () => {
    educationAdd(
      {
        body: {
          token,
          role,
          institution: schoolName,
        },
      },
      {
        onSuccess: (res) => {
          if (res.message === 'success') {
            void queryClient.invalidateQueries({ queryKey: consoleQuery.features.get.queryKey() })
            setHasSubmittedEducation(true)
          } else {
            toast.error(t(($) => $.submitError, { ns: 'education' }))
          }
        },
      },
    )
  }
  const handleOpenBillingPortal = async () => {
    if (isOpeningBillingPortal) return

    setIsOpeningBillingPortal(true)
    try {
      await openAsyncWindow(
        async () => {
          const res = await consoleClient.billing.invoices.get()
          if (res.url) return res.url

          throw new Error('Failed to open billing page')
        },
        {
          onError: (err) => {
            toast.error(err.message || String(err))
          },
        },
      )
    } finally {
      setIsOpeningBillingPortal(false)
    }
  }
  const renderBackToDifyButton = () => (
    <Link className={buttonVariants({ variant: 'ghost-accent' })} href="/">
      <span className="i-ri-arrow-left-line size-4" aria-hidden="true" />
      {t(($) => $['applied.noPaymentPermission.returnHome'], { ns: 'education' })}
    </Link>
  )
  const handleSwitchWorkspace = async (tenantId: string) => {
    if (tenantId === currentWorkspace?.id) return

    try {
      await switchWorkspaceMutation.mutateAsync({ body: { tenant_id: tenantId } })
      globalThis.location.reload()
    } catch {
      toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
    }
  }

  const renderAppliedEducationAction = () => {
    if (appliedEducationCase === AppliedEducationCase.eligible) {
      return (
        <Button variant="primary" onClick={handleEducationDiscount}>
          {t(($) => $.useEducationDiscount, { ns: 'education' })}
        </Button>
      )
    }

    if (appliedEducationCase === AppliedEducationCase.activeSubscription) {
      return (
        <div className="flex w-full flex-col items-start gap-3">
          <div className="flex w-full items-start rounded-lg border-[0.5px] border-components-badge-status-light-warning-halo bg-state-warning-hover px-3 py-2.5">
            <span
              className="mt-0.5 mr-2 i-ri-alert-fill size-4 shrink-0 text-text-warning-secondary"
              aria-hidden="true"
            />
            <div className="system-md-regular text-text-warning">
              <Trans
                i18nKey={($) => $['applied.activeSubscription.description']}
                ns="education"
                components={{
                  stripeLink: (
                    <button
                      type="button"
                      className="rounded-sm text-text-accent outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled"
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
          <span
            className="mt-0.5 mr-2 i-ri-alert-fill size-4 shrink-0 text-text-warning-secondary"
            aria-hidden="true"
          />
          <div className="system-md-regular text-text-warning">
            {t(($) => $['applied.noPaymentPermission.description'], { ns: 'education' })}
          </div>
        </div>
        {renderBackToDifyButton()}
      </div>
    )
  }

  return (
    <>
      <div className="mb-7">
        <UserInfo />
      </div>
      {isEducationAccount || hasSubmittedEducation ? (
        <div className="flex">
          <AppliedEducationWorkspaceContent
            currentWorkspace={currentWorkspace}
            plan={plan}
            action={renderAppliedEducationAction()}
            isSwitchingWorkspace={switchWorkspaceMutation.isPending}
            onSwitchWorkspace={(value) => {
              void handleSwitchWorkspace(value)
            }}
          />
        </div>
      ) : (
        <Form onFormSubmit={handleSubmit}>
          <InstitutionField value={schoolName} onValueChange={setSchoolName} />
          <RoleSelector value={role} onChange={setRole} />
          <Field name="agreements" className="mb-7">
            <Fieldset
              render={
                <CheckboxGroup
                  value={agreements}
                  onValueChange={setAgreements}
                  allValues={REQUIRED_AGREEMENTS}
                />
              }
            >
              <FieldsetLegend className="flex h-6 items-center py-0 system-md-semibold text-text-secondary">
                {t(($) => $['form.terms.title'], { ns: 'education' })}
              </FieldsetLegend>
              <FieldDescription className="mb-1 py-0 system-md-regular text-text-tertiary">
                {t(($) => $['form.terms.desc.front'], { ns: 'education' })}
                &nbsp;
                <a
                  href="https://dify.ai/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-secondary hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                >
                  {t(($) => $['form.terms.desc.termsOfService'], { ns: 'education' })}
                </a>
                &nbsp;
                {t(($) => $['form.terms.desc.and'], { ns: 'education' })}
                &nbsp;
                <a
                  href="https://dify.ai/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-secondary hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                >
                  {t(($) => $['form.terms.desc.privacyPolicy'], { ns: 'education' })}
                </a>
                {t(($) => $['form.terms.desc.end'], { ns: 'education' })}
              </FieldDescription>
              <div className="py-2 system-md-regular text-text-primary">
                <FieldItem>
                  <FieldLabel className="mb-2 flex items-start gap-2 py-0">
                    <Checkbox value="age" />
                    {t(($) => $['form.terms.option.age'], { ns: 'education' })}
                  </FieldLabel>
                </FieldItem>
                <FieldItem>
                  <FieldLabel className="mb-2 flex items-start gap-2 py-0">
                    <Checkbox value="inSchool" />
                    {t(($) => $['form.terms.option.inSchool'], { ns: 'education' })}
                  </FieldLabel>
                </FieldItem>
                <FieldItem>
                  <FieldLabel className="flex items-start gap-2 py-0">
                    <Checkbox value="personalUse" />
                    {t(($) => $['form.terms.option.personalUse'], { ns: 'education' })}
                  </FieldLabel>
                </FieldItem>
              </div>
            </Fieldset>
          </Field>
          <Button
            type="submit"
            variant="primary"
            loading={isPending}
            disabled={agreements.length !== REQUIRED_AGREEMENTS.length || !schoolName || !role}
          >
            {t(($) => $.submit, { ns: 'education' })}
          </Button>
          <div className="mt-5 mb-4 h-px bg-linear-to-r from-[rgba(16,24,40,0.08)]" />
          <a
            className="flex items-center system-xs-regular text-text-accent focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            href={docLink('/use-dify/workspace/subscription-management#dify-for-education')}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t(($) => $.learn, { ns: 'education' })}
            <span className="ml-1 i-ri-external-link-line size-3" aria-hidden="true" />
          </a>
        </Form>
      )}
    </>
  )
}

type AppliedEducationWorkspaceBlockProps = {
  currentWorkspace: GetWorkspacesCurrentSummaryResponse
  plan: SubscriptionModel['plan']
  action: ReactNode
  isSwitchingWorkspace: boolean
  onSwitchWorkspace: (tenantId: string) => void
}

function AppliedEducationWorkspaceContent({
  currentWorkspace,
  plan,
  action,
  isSwitchingWorkspace,
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
      isSwitchingWorkspace={isSwitchingWorkspace}
      onSwitchWorkspace={onSwitchWorkspace}
    />
  )
}

export default EducationApplyPage

type AppliedEducationCase = (typeof AppliedEducationCase)[keyof typeof AppliedEducationCase]
