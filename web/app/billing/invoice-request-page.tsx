'use client'

import type { BasicPlan, BillingInterval } from '@/app/components/billing/type'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { FieldControl, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { RadioControl, RadioGroup, RadioItem } from '@langgenius/dify-ui/radio'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import { ALL_PLANS } from '@/app/components/billing/config'
import { Professional, Sandbox, Team } from '@/app/components/billing/pricing/assets'
import { Plan } from '@/app/components/billing/type'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { useRouter, useSearchParams } from '@/next/navigation'
import { BillingPermission, hasPermission } from '@/utils/permission'
import { InvoiceRequestGridTexture } from './invoice-request-grid-texture'

const INVOICE_INTERVALS: BillingInterval[] = ['year', 'month']
const INVOICE_ICON_MAP = {
  [Plan.sandbox]: <Sandbox />,
  [Plan.professional]: <Professional />,
  [Plan.team]: <Team />,
}

const isInvoicePlan = (value: string | null): value is BasicPlan => {
  return value === Plan.professional || value === Plan.team
}

const normalizePlan = (value: string | null): BasicPlan => {
  return isInvoicePlan(value) ? value : Plan.professional
}

const normalizeInterval = (value: string | null): BillingInterval => {
  return value === 'year' || value === 'month' ? value : 'month'
}

const getPrice = (plan: BasicPlan, interval: BillingInterval) => {
  const monthlyPrice = ALL_PLANS[plan].price
  return interval === 'year' ? monthlyPrice * 10 : monthlyPrice
}

type InvoiceRequestFormValues = {
  company_name: string
  country: string
  address_line1: string
  address_line2?: string
  city: string
  state_or_province: string
  postal_code: string
  invoice_recipient_email: string
}

export default function InvoiceRequestPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isCurrentWorkspaceManager, userProfile, workspacePermissionKeys } = useAppContext()
  const { plan: currentPlan } = useProviderContext()
  const [submittedEmail, setSubmittedEmail] = useState('')
  const [billingActionClicked, setBillingActionClicked] = useState(false)
  const [logoutActionClicked, setLogoutActionClicked] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const plan = normalizePlan(searchParams.get('plan'))
  const interval = normalizeInterval(searchParams.get('cycle'))
  const canRequestInvoice = isCurrentWorkspaceManager && hasPermission(workspacePermissionKeys, BillingPermission.Manage)
  const isInvoiceFlowLocked = !!currentPlan.invoiceFlow?.locked
  const price = getPrice(plan, interval)

  const handleBack = () => {
    router.back()
  }

  const handleLogout = () => {
    setLogoutActionClicked(true)
  }

  const updateInterval = (nextInterval: BillingInterval) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('plan', plan)
    params.set('cycle', nextInterval)
    router.replace(`/billing/invoice-request?${params.toString()}`)
  }

  const handleOpenBillingSettings = () => {
    setBillingActionClicked(true)
  }

  const handleSubmit = (formValues: InvoiceRequestFormValues) => {
    if (!canRequestInvoice) {
      toast.error(t('invoice.permissionDeniedTooltip', { ns: 'billing' }))
      return
    }

    if (isInvoiceFlowLocked) {
      toast.error(t('invoice.lockedTip', { ns: 'billing' }))
      return
    }

    if (!termsAccepted) {
      toast.error(t('invoice.form.termsRequired', { ns: 'billing' }))
      return
    }

    setSubmittedEmail(formValues.invoice_recipient_email)
  }

  if (submittedEmail) {
    return (
      <div className="fixed inset-0 z-31 overflow-y-auto bg-background-default p-6">
        <div className="mx-auto flex min-h-[calc(100dvh-48px)] w-full items-center justify-center">
          <div className="relative flex min-h-[373px] w-full max-w-[600px] flex-col gap-3 overflow-hidden rounded-3xl border-[0.5px] border-components-panel-border-subtle bg-background-section p-8">
            <InvoiceRequestGridTexture />
            <div className="relative z-1 flex w-full justify-end pb-2">
              <DifyLogo size="large" className="h-[27px] w-[60px]" />
            </div>
            <div className="relative z-1 flex size-13 items-center justify-center rounded-xl border-[0.5px] border-components-panel-border-subtle bg-background-default-lighter text-saas-dify-blue-accessible shadow-lg backdrop-blur-[5px]">
              <span className="i-ri-mail-send-fill size-6" aria-hidden="true" />
            </div>
            <div className="relative z-1 flex w-full flex-col gap-1 pt-1 break-words">
              <h1 className="title-2xl-semi-bold text-text-primary">{t('invoice.requestReceived.title', { ns: 'billing' })}</h1>
              <p className="system-md-regular text-text-secondary">
                <Trans
                  i18nKey="invoice.requestReceived.description"
                  ns="billing"
                  values={{ email: submittedEmail }}
                  components={{
                    email: <span className="system-md-semibold text-text-secondary" />,
                    day: <span className="system-md-semibold text-text-secondary" />,
                  }}
                />
              </p>
            </div>
            <div className="relative z-1 flex w-full flex-col gap-2 pt-2 pb-3">
              <p className="system-xs-regular text-text-tertiary">
                {t('invoice.requestReceived.statusTip', { ns: 'billing' })}
              </p>
              <p className="system-xs-regular text-text-tertiary">
                {t('invoice.requestReceived.renewalTip', { ns: 'billing' })}
              </p>
            </div>
            <Button
              size="medium"
              variant="primary"
              data-local-clicked={billingActionClicked || undefined}
              className="relative z-1 gap-1 px-3"
              onClick={handleOpenBillingSettings}
            >
              <span>{t('invoice.requestReceived.goToBilling', { ns: 'billing' })}</span>
              <span className="i-ri-arrow-right-line size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-31 overflow-y-auto bg-background-default">
      <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(360px,724px)_minmax(560px,1fr)]">
        <aside className="flex min-h-dvh justify-center bg-background-section-burn px-6 py-10 lg:justify-end lg:px-10">
          <div className="relative flex w-full max-w-80 flex-col">
            <button
              type="button"
              aria-label={t('operation.back', { ns: 'common' })}
              className="absolute top-0 -left-13 hidden size-8 items-center justify-center rounded-full border border-divider-subtle bg-background-default text-text-secondary shadow-xs hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden lg:flex"
              onClick={handleBack}
            >
              <span aria-hidden="true" className="i-ri-arrow-left-line size-4" />
            </button>
            <div className="flex items-start gap-6">
              <DifyLogo size="large" />
              <div className="min-w-0">
                <div className="title-xl-semi-bold text-text-primary">{t('invoice.summary.title', { ns: 'billing' })}</div>
                <div className="mt-1 system-sm-regular text-text-tertiary">{t('invoice.summary.subtitle', { ns: 'billing' })}</div>
              </div>
            </div>

            <div className="mt-8 rounded-lg border border-effects-highlight bg-background-default-subtle p-6 shadow-xs">
              <div className="size-10 overflow-hidden">
                <div className="origin-top-left scale-[0.66]">
                  {INVOICE_ICON_MAP[plan]}
                </div>
              </div>
              <h1 className="mt-5 title-2xl-semi-bold text-text-primary">{t(`plans.${plan}.name`, { ns: 'billing' })}</h1>
              <div className="mt-4 flex items-end gap-1.5">
                <span className="title-2xl-semi-bold text-text-primary">
                  $
                  {price}
                </span>
                <span className="pb-0.5 system-sm-regular text-text-tertiary">
                  {t('plansCommon.priceTip', { ns: 'billing' })}
                  {t(`plansCommon.${interval}`, { ns: 'billing' })}
                </span>
              </div>
              <RadioGroup<BillingInterval>
                className="mt-6 flex-col items-stretch gap-2"
                value={interval}
                onValueChange={(nextInterval) => {
                  if (nextInterval)
                    updateInterval(nextInterval)
                }}
                aria-label={t('invoice.summary.billingCycle', { ns: 'billing' })}
              >
                {INVOICE_INTERVALS.map(item => (
                  <RadioItem<BillingInterval>
                    key={item}
                    value={item}
                    className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg px-3 text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid data-checked:border-state-accent-solid data-checked:text-text-primary"
                  >
                    <RadioControl aria-hidden="true" />
                    <span className="grow system-sm-semibold">{t(`plansCommon.${item}`, { ns: 'billing' })}</span>
                    {item === 'year' && (
                      <span className="rounded border border-state-accent-solid px-1 system-2xs-semibold-uppercase text-text-accent">
                        {t('invoice.summary.saveAnnual', { ns: 'billing', percent: 17 })}
                      </span>
                    )}
                  </RadioItem>
                ))}
              </RadioGroup>
            </div>

            <div className="mt-auto hidden border-t border-divider-subtle pt-4 lg:flex">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar avatar={userProfile.avatar_url} name={userProfile.name} />
                <div className="min-w-0">
                  <div className="truncate system-sm-medium text-text-primary">{userProfile.name}</div>
                  <div className="truncate system-xs-regular text-text-tertiary">{userProfile.email}</div>
                </div>
              </div>
              <button
                type="button"
                disabled={logoutActionClicked}
                className={cn(
                  'system-sm-regular text-text-secondary hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
                  logoutActionClicked && 'cursor-not-allowed text-text-disabled hover:text-text-disabled',
                )}
                onClick={handleLogout}
              >
                {t('userProfile.logout', { ns: 'common' })}
              </button>
            </div>
          </div>
        </aside>
        <main className="bg-background-default px-6 py-10 lg:px-10">
          <div className="w-full max-w-[480px]">
            <div className="mb-6">
              <h2 className="title-xl-semi-bold text-text-primary">{t('invoice.form.title', { ns: 'billing' })}</h2>
              <p className="mt-1 system-sm-regular text-text-tertiary">{t('invoice.form.description', { ns: 'billing' })}</p>
            </div>
            <Form<InvoiceRequestFormValues> className="grid gap-6" onFormSubmit={handleSubmit}>
              <FieldRoot name="company_name">
                <FieldLabel>{t('invoice.form.companyName', { ns: 'billing' })}</FieldLabel>
                <FieldControl required size="large" autoComplete="organization" placeholder={t('invoice.form.placeholder.companyName', { ns: 'billing' })} />
              </FieldRoot>
              <FieldRoot name="country">
                <FieldLabel>{t('invoice.form.country', { ns: 'billing' })}</FieldLabel>
                <FieldControl required size="large" autoComplete="country-name" placeholder={t('invoice.form.placeholder.country', { ns: 'billing' })} />
              </FieldRoot>
              <FieldRoot name="address_line1">
                <FieldLabel>{t('invoice.form.addressLine1', { ns: 'billing' })}</FieldLabel>
                <FieldControl required size="large" autoComplete="address-line1" placeholder={t('invoice.form.placeholder.addressLine1', { ns: 'billing' })} />
              </FieldRoot>
              <FieldRoot name="address_line2">
                <FieldLabel>{t('invoice.form.addressLine2', { ns: 'billing' })}</FieldLabel>
                <FieldControl size="large" autoComplete="address-line2" placeholder={t('invoice.form.placeholder.addressLine2', { ns: 'billing' })} />
              </FieldRoot>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <FieldRoot name="city">
                  <FieldLabel>{t('invoice.form.city', { ns: 'billing' })}</FieldLabel>
                  <FieldControl required size="large" autoComplete="address-level2" placeholder={t('invoice.form.placeholder.city', { ns: 'billing' })} />
                </FieldRoot>
                <FieldRoot name="state_or_province">
                  <FieldLabel>{t('invoice.form.stateOrProvince', { ns: 'billing' })}</FieldLabel>
                  <FieldControl required size="large" autoComplete="address-level1" placeholder={t('invoice.form.placeholder.stateOrProvince', { ns: 'billing' })} />
                </FieldRoot>
                <FieldRoot name="postal_code">
                  <FieldLabel>{t('invoice.form.postalCode', { ns: 'billing' })}</FieldLabel>
                  <FieldControl required size="large" autoComplete="postal-code" placeholder={t('invoice.form.placeholder.postalCode', { ns: 'billing' })} />
                </FieldRoot>
              </div>
              <FieldRoot name="invoice_recipient_email">
                <FieldLabel>{t('invoice.form.invoiceEmail', { ns: 'billing' })}</FieldLabel>
                <FieldControl required size="large" type="email" autoComplete="email" placeholder={t('invoice.form.placeholder.invoiceEmail', { ns: 'billing' })} />
              </FieldRoot>
              <label className="flex min-h-22 cursor-pointer items-start gap-2 py-2">
                <Checkbox
                  checked={termsAccepted}
                  onCheckedChange={checked => setTermsAccepted(checked === true)}
                  aria-label={t('invoice.form.terms', { ns: 'billing' })}
                />
                <span className="system-sm-regular text-text-secondary">{t('invoice.form.terms', { ns: 'billing' })}</span>
              </label>
              <Button
                type="submit"
                variant="primary"
                size="large"
                className="w-full"
              >
                {t('invoice.form.submit', { ns: 'billing' })}
              </Button>
            </Form>
          </div>
        </main>
      </div>
    </div>
  )
}
