import type { ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/app/components/base/ui/button'
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/app/components/base/ui/dropdown-menu'
import { toast } from '@/app/components/base/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { getDocDownloadUrl } from '@/service/common'
import { downloadUrl } from '@/utils/download'
import Gdpr from '../../base/icons/src/public/common/Gdpr'
import Iso from '../../base/icons/src/public/common/Iso'
import Soc2 from '../../base/icons/src/public/common/Soc2'
import SparklesSoft from '../../base/icons/src/public/common/SparklesSoft'
import PremiumBadge from '../../base/premium-badge'
import { MenuItemContent } from './menu-item-content'

enum DocName {
  SOC2_Type_I = 'SOC2_Type_I',
  SOC2_Type_II = 'SOC2_Type_II',
  ISO_27001 = 'ISO_27001',
  GDPR = 'GDPR',
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
      <Button
        size="small"
        disabled={isPending}
        loading={isPending}
        aria-hidden
        className="pointer-events-none flex items-center gap-px"
      >
        <span className="i-ri-arrow-down-circle-line size-[14px] text-components-button-secondary-text-disabled" />
        <span className="px-[3px] system-xs-medium text-components-button-secondary-text">{downloadText}</span>
      </Button>
    )
  }

  const canShowUpgradeTooltip = tooltipText.length > 0

  return (
    <Tooltip>
      <TooltipTrigger
        delay={0}
        disabled={!canShowUpgradeTooltip}
        render={(
          <PremiumBadge color="blue" allowHover={true}>
            <SparklesSoft className="flex h-3.5 w-3.5 items-center py-px pl-[3px] text-components-premium-badge-indigo-text-stop-0" />
            <div className="px-1 system-xs-medium">
              {upgradeText}
            </div>
          </PremiumBadge>
        )}
      />
      {canShowUpgradeTooltip && (
        <TooltipContent>
          {tooltipText}
        </TooltipContent>
      )}
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
        toast.success(t('operation.downloadSuccess', { ns: 'common' }))
      }
      catch (error) {
        console.error(error)
        toast.error(t('operation.downloadFailed', { ns: 'common' }))
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
      className="h-10 justify-between py-1 pr-2 pl-1"
      closeOnClick={!isCurrentPlanCanDownload}
      onClick={handleSelect}
    >
      {icon}
      <div className="grow truncate px-1 system-md-regular text-text-secondary">{label}</div>
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
      <DropdownMenuSubTrigger>
        <MenuItemContent
          iconClassName="i-ri-verified-badge-line"
          label={t('userProfile.compliance', { ns: 'common' })}
        />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        popupClassName="w-[337px] divide-y divide-divider-subtle bg-components-panel-bg-blur! py-0! backdrop-blur-xs"
      >
        <DropdownMenuGroup className="py-1">
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
