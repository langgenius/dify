'use client'
import type { BasicPlan, InvoiceFlow, InvoiceFlowStatus } from '../../../type'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@langgenius/dify-ui/tooltip'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import Link from '@/next/link'
import { fetchSubscriptionUrls } from '@/service/billing'
import { consoleClient } from '@/service/client'
import { BillingPermission, hasPermission } from '@/utils/permission'
import { ALL_PLANS } from '../../../config'
import { useEducationDiscount } from '../../../hooks/use-education-discount'
import { Plan } from '../../../type'
import { Professional, Sandbox, Team } from '../../assets'
import { PlanRange } from '../../plan-switcher/plan-range-switcher'
import PlanButton from './button'
import List from './list'

const ICON_MAP = {
  [Plan.sandbox]: <Sandbox />,
  [Plan.professional]: <Professional />,
  [Plan.team]: <Team />,
}

type CloudPlanItemProps = {
  currentPlan: BasicPlan
  plan: BasicPlan
  planRange: PlanRange
  canPay: boolean
  invoiceFlow?: InvoiceFlow | null
}

const INVOICE_FLOW_BUTTON_TEXT_KEY = {
  request_processing: 'invoice.status.processing',
  invoice_sent: 'invoice.status.awaitingPayment',
  renewal_invoice_sent: 'invoice.status.awaitingPayment',
  payment_confirming: 'invoice.status.confirmingPayment',
  renewal_past_due: 'invoice.status.paymentOverdue',
} as const satisfies Partial<Record<InvoiceFlowStatus, string>>

type InvoiceFlowButtonStatus = keyof typeof INVOICE_FLOW_BUTTON_TEXT_KEY

const isInvoiceFlowButtonStatus = (status: InvoiceFlowStatus): status is InvoiceFlowButtonStatus => {
  return status in INVOICE_FLOW_BUTTON_TEXT_KEY
}

function CloudPlanItem({
  plan,
  currentPlan,
  planRange,
  canPay,
  invoiceFlow,
}: CloudPlanItemProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = React.useState(false)
  const i18nPrefix = `plans.${plan}` as const
  const isFreePlan = plan === Plan.sandbox
  const isMostPopularPlan = plan === Plan.professional
  const planInfo = ALL_PLANS[plan]
  const isYear = planRange === PlanRange.yearly
  const isCurrent = plan === currentPlan
  const isCurrentPaidPlan = isCurrent && !isFreePlan
  const isInvoiceFlowLocked = !!invoiceFlow?.locked
  const isInvoiceFlowPlan = invoiceFlow?.plan === plan
  const invoiceFlowButtonTextKey = isInvoiceFlowPlan && invoiceFlow?.status && isInvoiceFlowButtonStatus(invoiceFlow.status)
    ? INVOICE_FLOW_BUTTON_TEXT_KEY[invoiceFlow.status]
    : undefined
  const isPlanDisabled = isInvoiceFlowLocked || (isCurrentPaidPlan ? false : planInfo.level <= ALL_PLANS[currentPlan].level)
  const { isCurrentWorkspaceManager, workspacePermissionKeys } = useAppContext()
  const canManageBilling = hasPermission(workspacePermissionKeys, BillingPermission.Manage)
  const canManageBillingSubscription = hasPermission(workspacePermissionKeys, BillingPermission.SubscriptionManage)
  const { enableEducationPlan, isEducationAccount } = useProviderContext()
  const isEducationDiscountMode = enableEducationPlan && isEducationAccount
  const isEducationDiscountSupportedPlan = plan === Plan.professional && isYear
  const educationDiscountWarningText = canPay && isEducationDiscountMode && !isFreePlan && !isEducationDiscountSupportedPlan
    ? t('planNotSupportEducationDiscount', { ns: 'education' })
    : undefined
  const openAsyncWindow = useAsyncWindowOpen()
  const { handleEducationDiscount, isEducationDiscountLoading } = useEducationDiscount()
  const [showEducationPricingConfirm, setShowEducationPricingConfirm] = React.useState(false)
  const canRequestInvoice = canPay && isCurrentWorkspaceManager && canManageBilling
  const isPayByInvoiceVisible = !isFreePlan
  const invoiceRequestUrl = `/billing/invoice-request?plan=${plan}&cycle=${isYear ? 'year' : 'month'}`
  const isPayByInvoiceDisabled = !canRequestInvoice || isInvoiceFlowLocked

  let btnText: string
  if (invoiceFlowButtonTextKey) {
    btnText = t(invoiceFlowButtonTextKey, { ns: 'billing' })
  }
  else if (canPay && isEducationDiscountMode && isEducationDiscountSupportedPlan && !isCurrent) {
    btnText = t('useEducationDiscount', { ns: 'education' })
  }
  else if (isCurrent) {
    btnText = t('plansCommon.currentPlan', { ns: 'billing' })
  }
  else {
    btnText = ({
      [Plan.sandbox]: t('plansCommon.startForFree', { ns: 'billing' }),
      [Plan.professional]: t('plansCommon.startBuilding', { ns: 'billing' }),
      [Plan.team]: t('plansCommon.getStarted', { ns: 'billing' }),
    })[plan]
  }

  const handlePayCurrentPlan = async () => {
    if (loading || isEducationDiscountLoading)
      return

    if (isPlanDisabled)
      return

    setLoading(true)
    try {
      if (isCurrentPaidPlan) {
        if (!canManageBillingSubscription) {
          toast.error(t('buyPermissionDeniedTip', { ns: 'billing' }))
          return
        }

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
        return
      }

      if (isFreePlan)
        return

      if (!canManageBilling) {
        toast.error(t('buyPermissionDeniedTip', { ns: 'billing' }))
        return
      }

      if (isEducationDiscountMode && isEducationDiscountSupportedPlan) {
        await handleEducationDiscount()
        return
      }

      const res = await fetchSubscriptionUrls(plan, isYear ? 'year' : 'month')
      // Adb Block additional tracking block the gtag, so we need to redirect directly
      window.location.href = res.url
    }
    finally {
      setLoading(false)
    }
  }
  const handleGetPayUrl = async () => {
    if (isInvoiceFlowLocked)
      return

    if (educationDiscountWarningText && !isPlanDisabled) {
      setShowEducationPricingConfirm(true)
      return
    }

    await handlePayCurrentPlan()
  }
  const handleSwitchToProfessionalAnnual = async () => {
    await handleEducationDiscount()
  }
  const handleKeepCurrentPlan = async () => {
    await handlePayCurrentPlan()
    setShowEducationPricingConfirm(false)
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col pb-3">
      <div className="flex flex-col px-5 py-4">
        <div className="flex flex-col gap-y-6 px-1 pt-10">
          {ICON_MAP[plan]}
          <div className="flex min-h-26 flex-col gap-y-2">
            <div className="flex items-center gap-x-2.5">
              <div className="text-[30px] leading-[1.2] font-medium text-text-primary">{t(`${i18nPrefix}.name`, { ns: 'billing' })}</div>
              {
                isMostPopularPlan && (
                  <div className="flex items-center justify-center bg-saas-dify-blue-static px-1.5 py-1">
                    <span className="system-2xs-semibold-uppercase text-text-primary-on-surface">
                      {t('plansCommon.mostPopular', { ns: 'billing' })}
                    </span>
                  </div>
                )
              }
            </div>
            <div className="system-sm-regular text-text-secondary">{t(`${i18nPrefix}.description`, { ns: 'billing' })}</div>
          </div>
        </div>
        {/* Price */}
        <div className="flex items-end gap-x-2 px-1 pt-4 pb-8">
          {isFreePlan && (
            <span className="title-4xl-semi-bold text-text-primary">{t('plansCommon.free', { ns: 'billing' })}</span>
          )}
          {!isFreePlan && (
            <>
              {isYear && (
                <span className="title-4xl-semi-bold text-text-quaternary line-through">
                  $
                  {planInfo.price * 12}
                </span>
              )}
              <span className="title-4xl-semi-bold text-text-primary">
                $
                {isYear ? planInfo.price * 10 : planInfo.price}
              </span>
              <span className="pb-0.5 system-md-regular text-text-tertiary">
                {t('plansCommon.priceTip', { ns: 'billing' })}
                {t(`plansCommon.${!isYear ? 'month' : 'year'}`, { ns: 'billing' })}
              </span>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <PlanButton
            plan={plan}
            isPlanDisabled={isPlanDisabled}
            btnText={btnText}
            handleGetPayUrl={handleGetPayUrl}
            warningText={educationDiscountWarningText}
            className={isPayByInvoiceVisible ? 'min-w-0 flex-1' : undefined}
          />
          {isPayByInvoiceVisible && (
            <PayByInvoiceAction
              href={invoiceRequestUrl}
              disabled={isPayByInvoiceDisabled}
              tooltip={canRequestInvoice ? undefined : t('invoice.permissionDeniedTooltip', { ns: 'billing' })}
            />
          )}
        </div>
      </div>
      <List plan={plan} />
      <Dialog
        open={showEducationPricingConfirm}
        onOpenChange={setShowEducationPricingConfirm}
      >
        <DialogContent
          backdropProps={{ forceRender: true }}
          className="w-[520px]"
        >
          <DialogCloseButton
            aria-label={t('operation.close', { ns: 'common' })}
            className="top-6 right-6"
          />
          <div className="flex flex-col gap-2 pr-10">
            <DialogTitle className="w-full title-2xl-semi-bold text-text-primary">
              {t('educationPricingConfirm.title', { ns: 'education' })}
            </DialogTitle>
            <DialogDescription className="w-full system-md-regular text-text-tertiary">
              {t('educationPricingConfirm.description', { ns: 'education' })}
            </DialogDescription>
          </div>
          <div className="mt-10 flex items-start justify-end gap-3">
            <Button
              size="large"
              onClick={handleKeepCurrentPlan}
              disabled={loading || isEducationDiscountLoading}
              loading={loading}
              className="min-w-38"
            >
              {t('educationPricingConfirm.cancel', { ns: 'education' })}
            </Button>
            <Button
              variant="primary"
              size="large"
              onClick={handleSwitchToProfessionalAnnual}
              disabled={isEducationDiscountLoading}
              loading={isEducationDiscountLoading}
              className="min-w-61"
            >
              {t('educationPricingConfirm.continue', { ns: 'education' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
export default CloudPlanItem

type PayByInvoiceActionProps = {
  href: string
  disabled: boolean
  tooltip?: string
}

function PayByInvoiceAction({
  href,
  disabled,
  tooltip,
}: PayByInvoiceActionProps) {
  const { t } = useTranslation()
  const label = t('invoice.payByInvoice', { ns: 'billing' })
  const className = 'flex min-h-12 min-w-0 flex-1 items-center gap-2 border border-components-panel-border bg-background-default py-3 pr-4 pl-5 system-xl-semibold text-text-secondary hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden'
  const disabledClassName = 'flex min-h-12 min-w-0 flex-1 cursor-not-allowed items-center gap-2 border border-transparent bg-components-button-tertiary-bg-disabled py-3 pr-4 pl-5 system-xl-semibold text-text-disabled'

  if (!disabled) {
    return (
      <Link
        href={href}
        className={className}
      >
        <span className="min-w-0 grow truncate text-start">{label}</span>
        <span aria-hidden="true" className="i-ri-arrow-right-line size-5 shrink-0" />
      </Link>
    )
  }

  const action = (
    <span
      aria-disabled="true"
      className={disabledClassName}
    >
      <span className="min-w-0 grow truncate text-start">{label}</span>
    </span>
  )

  if (!tooltip)
    return action

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <button
            type="button"
            aria-disabled="true"
            aria-label={tooltip}
            className="flex min-w-0 flex-1 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            {action}
          </button>
        )}
      />
      <TooltipContent>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
