import type { ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/app/components/base/ui/dropdown-menu'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { getDocDownloadUrl } from '@/service/common'
import { cn } from '@/utils/classnames'
import { downloadUrl } from '@/utils/download'
import Gdpr from '../../base/icons/src/public/common/Gdpr'
import Iso from '../../base/icons/src/public/common/Iso'
import Soc2 from '../../base/icons/src/public/common/Soc2'
import SparklesSoft from '../../base/icons/src/public/common/SparklesSoft'
import PremiumBadge from '../../base/premium-badge'
import Spinner from '../../base/spinner'
import Toast from '../../base/toast'
import Tooltip from '../../base/tooltip'

const submenuTriggerClassName = '!mx-0 !h-8 !rounded-lg !px-3 data-[highlighted]:!bg-state-base-hover'
const submenuItemClassName = '!mx-0 !h-10 !rounded-lg !py-1 !pl-1 !pr-2 data-[highlighted]:!bg-state-base-hover'
const menuLabelClassName = 'grow px-1 text-text-secondary system-md-regular'
const menuLeadingIconClassName = 'size-4 shrink-0 text-text-tertiary'
const menuTrailingIconClassName = 'size-[14px] shrink-0 text-text-tertiary'

enum DocName {
  SOC2_Type_I = 'SOC2_Type_I',
  SOC2_Type_II = 'SOC2_Type_II',
  ISO_27001 = 'ISO_27001',
  GDPR = 'GDPR',
}

type ComplianceMenuItemContentProps = {
  iconClassName: string
  label: ReactNode
  trailing?: ReactNode
}

function ComplianceMenuItemContent({
  iconClassName,
  label,
  trailing,
}: ComplianceMenuItemContentProps) {
  return (
    <>
      <span aria-hidden className={cn(menuLeadingIconClassName, iconClassName)} />
      <div className={menuLabelClassName}>{label}</div>
      {trailing}
    </>
  )
}

type ComplianceDocActionVisualProps = {
  isCurrentPlanCanDownload: boolean
  isPending: boolean
  tooltipText: string
  downloadText: string
  upgradeText: string
}

function ComplianceDocActionVisual({
  isCurrentPlanCanDownload,
  isPending,
  tooltipText,
  downloadText,
  upgradeText,
}: ComplianceDocActionVisualProps) {
  if (isCurrentPlanCanDownload) {
    return (
      <div
        aria-hidden
        className={cn(
          'btn btn-small btn-secondary pointer-events-none flex items-center gap-[1px]',
          isPending && 'btn-disabled',
        )}
      >
        <span className="i-ri-arrow-down-circle-line size-[14px] text-components-button-secondary-text-disabled" />
        <span className="px-[3px] text-components-button-secondary-text system-xs-medium">{downloadText}</span>
        {isPending && <Spinner loading={true} className="!ml-1 !h-3 !w-3 !border-2 !text-text-tertiary" />}
      </div>
    )
  }

  return (
    <Tooltip asChild={false} popupContent={tooltipText}>
      <PremiumBadge color="blue" allowHover={true}>
        <SparklesSoft className="flex h-3.5 w-3.5 items-center py-[1px] pl-[3px] text-components-premium-badge-indigo-text-stop-0" />
        <div className="px-1 system-xs-medium">
          {upgradeText}
        </div>
      </PremiumBadge>
    </Tooltip>
  )
}

type ComplianceDocRowItemProps = {
  icon: ReactNode
  label: ReactNode
  docName: DocName
}

function ComplianceDocRowItem({
  icon,
  label,
  docName,
}: ComplianceDocRowItemProps) {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const { setShowPricingModal, setShowAccountSettingModal } = useModalContext()
  const isFreePlan = plan.type === Plan.sandbox

  const { isPending, mutate: downloadCompliance } = useMutation({
    mutationKey: ['downloadCompliance', docName],
    mutationFn: async () => {
      try {
        const ret = await getDocDownloadUrl(docName)
        downloadUrl({ url: ret.url })
        Toast.notify({
          type: 'success',
          message: t('operation.downloadSuccess', { ns: 'common' }),
        })
      }
      catch (error) {
        console.error(error)
        Toast.notify({
          type: 'error',
          message: t('operation.downloadFailed', { ns: 'common' }),
        })
      }
    },
  })

  const whichPlanCanDownloadCompliance = {
    [DocName.SOC2_Type_I]: [Plan.professional, Plan.team],
    [DocName.SOC2_Type_II]: [Plan.team],
    [DocName.ISO_27001]: [Plan.team],
    [DocName.GDPR]: [Plan.team, Plan.professional, Plan.sandbox],
  }

  const isCurrentPlanCanDownload = whichPlanCanDownloadCompliance[docName].includes(plan.type)

  const handleSelect = useCallback(() => {
    if (isCurrentPlanCanDownload) {
      if (!isPending)
        downloadCompliance()
      return
    }

    if (isFreePlan)
      setShowPricingModal()
    else
      setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.BILLING })
  }, [downloadCompliance, isCurrentPlanCanDownload, isFreePlan, isPending, setShowAccountSettingModal, setShowPricingModal])

  const upgradeTooltip: Record<Plan, string> = {
    [Plan.sandbox]: t('compliance.sandboxUpgradeTooltip', { ns: 'common' }),
    [Plan.professional]: t('compliance.professionalUpgradeTooltip', { ns: 'common' }),
    [Plan.team]: '',
    [Plan.enterprise]: '',
  }

  return (
    <DropdownMenuItem
      className={cn(submenuItemClassName, 'justify-between')}
      closeOnClick={false}
      onClick={handleSelect}
    >
      {icon}
      <div className="grow truncate px-1 text-text-secondary system-md-regular">{label}</div>
      <ComplianceDocActionVisual
        isCurrentPlanCanDownload={isCurrentPlanCanDownload}
        isPending={isPending}
        tooltipText={upgradeTooltip[plan.type]}
        downloadText={t('operation.download', { ns: 'common' })}
        upgradeText={t('upgradeBtn.encourageShort', { ns: 'billing' })}
      />
    </DropdownMenuItem>
  )
}

// Submenu-only: this component must be rendered within an existing DropdownMenu root.
export default function Compliance() {
  const { t } = useTranslation()

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={cn(submenuTriggerClassName, 'justify-between')}>
        <ComplianceMenuItemContent
          iconClassName="i-ri-verified-badge-line"
          label={t('userProfile.compliance', { ns: 'common' })}
          trailing={<span aria-hidden className={cn('i-ri-arrow-right-s-line', menuTrailingIconClassName)} />}
        />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        popupClassName="!w-[337px] !max-h-[70vh] !overflow-y-auto !divide-y !divide-divider-subtle !rounded-xl !bg-components-panel-bg-blur !py-0 !shadow-lg !backdrop-blur-sm"
      >
        <DropdownMenuGroup className="p-1">
          <ComplianceDocRowItem
            icon={<Soc2 aria-hidden className="size-7 shrink-0" />}
            label={t('compliance.soc2Type1', { ns: 'common' })}
            docName={DocName.SOC2_Type_I}
          />
          <ComplianceDocRowItem
            icon={<Soc2 aria-hidden className="size-7 shrink-0" />}
            label={t('compliance.soc2Type2', { ns: 'common' })}
            docName={DocName.SOC2_Type_II}
          />
          <ComplianceDocRowItem
            icon={<Iso aria-hidden className="size-7 shrink-0" />}
            label={t('compliance.iso27001', { ns: 'common' })}
            docName={DocName.ISO_27001}
          />
          <ComplianceDocRowItem
            icon={<Gdpr aria-hidden className="size-7 shrink-0" />}
            label={t('compliance.gdpr', { ns: 'common' })}
            docName={DocName.GDPR}
          />
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
