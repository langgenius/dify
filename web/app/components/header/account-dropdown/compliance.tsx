import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
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

const DocName = {
  SOC2_Type_I: 'SOC2_Type_I',
  SOC2_Type_II: 'SOC2_Type_II',
  ISO_27001: 'ISO_27001',
  GDPR: 'GDPR',
} as const
type DocName = (typeof DocName)[keyof typeof DocName]

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
        className="pointer-events-none flex items-center"
      >
        <span className="i-ri-arrow-down-circle-line size-3.5 text-components-button-secondary-text-disabled" />
        <span className="system-xs-medium text-components-button-secondary-text">
          {downloadText}
        </span>
      </Button>
    )
  }

  const canShowUpgradeTooltip = tooltipText.length > 0

  return (
    <Tooltip>
      <TooltipTrigger
        disabled={!canShowUpgradeTooltip}
        render={
          <PremiumBadge color="blue" allowHover={true}>
            <SparklesSoft
              aria-hidden="true"
              className="flex h-3.5 w-3.5 items-center py-px pl-0.75 text-components-premium-badge-indigo-text-stop-0"
            />
            <div className="px-1 system-xs-medium">{upgradeText}</div>
          </PremiumBadge>
        }
      />
      {canShowUpgradeTooltip && <TooltipContent>{tooltipText}</TooltipContent>}
    </Tooltip>
  )
}

type ComplianceDocRowItemProps = {
  icon: ReactNode
  label: ReactNode
  docName: DocName
}

function ComplianceDocRowItem({ icon, label, docName }: ComplianceDocRowItemProps) {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const { setShowPricingModal } = useModalContext()
  const [, setSettingsDestination] = useQueryState(settingsQueryParamName, settingsQueryParser)
  const isFreePlan = plan.type === 'sandbox'

  const { isPending, mutate: downloadCompliance } = useMutation({
    mutationKey: ['downloadCompliance', docName],
    mutationFn: async () => {
      try {
        const ret = await getDocDownloadUrl(docName)
        downloadUrl({ url: ret.url })
        toast.success(t(($) => $['operation.downloadSuccess'], { ns: 'common' }))
      } catch (error) {
        console.error(error)
        toast.error(t(($) => $['operation.downloadFailed'], { ns: 'common' }))
      }
    },
  })

  const whichPlanCanDownloadCompliance: Record<DocName, CloudPlan[]> = {
    [DocName.SOC2_Type_I]: ['professional', 'team'],
    [DocName.SOC2_Type_II]: ['team'],
    [DocName.ISO_27001]: ['team'],
    [DocName.GDPR]: ['team', 'professional', 'sandbox'],
  }

  const isCurrentPlanCanDownload = whichPlanCanDownloadCompliance[docName].includes(plan.type)

  const handleSelect = useCallback(() => {
    if (isCurrentPlanCanDownload) {
      if (!isPending) downloadCompliance()
      return
    }

    if (isFreePlan) setShowPricingModal()
    else setSettingsDestination('billing')
  }, [
    downloadCompliance,
    isCurrentPlanCanDownload,
    isFreePlan,
    isPending,
    setSettingsDestination,
    setShowPricingModal,
  ])

  const upgradeTooltip: Record<CloudPlan, string> = {
    sandbox: t(($) => $['compliance.sandboxUpgradeTooltip'], { ns: 'common' }),
    professional: t(($) => $['compliance.professionalUpgradeTooltip'], { ns: 'common' }),
    team: '',
  }
  const labelTitle = typeof label === 'string' ? label : undefined

  return (
    <DropdownMenuItem
      className="h-10 justify-between py-1 pr-2 pl-1"
      closeOnClick={!isCurrentPlanCanDownload}
      onClick={handleSelect}
    >
      {icon}
      <div className="grow truncate px-1 system-md-regular text-text-secondary" title={labelTitle}>
        {label}
      </div>
      <ComplianceDocActionVisual
        isCurrentPlanCanDownload={isCurrentPlanCanDownload}
        isPending={isPending}
        tooltipText={upgradeTooltip[plan.type]}
        downloadText={t(($) => $['operation.download'], { ns: 'common' })}
        upgradeText={t(($) => $['upgradeBtn.encourageShort'], { ns: 'billing' })}
      />
    </DropdownMenuItem>
  )
}

// Submenu-only: this component must be rendered within an existing DropdownMenu root.
export default function Compliance() {
  const { t } = useTranslation()

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="mx-0 h-8 gap-1 px-3 py-1">
        <MenuItemContent
          iconClassName="i-ri-verified-badge-line"
          label={t(($) => $['userProfile.compliance'], { ns: 'common' })}
        />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-[337px] divide-y divide-divider-subtle bg-components-panel-bg-blur! py-0! backdrop-blur-xs">
        <DropdownMenuGroup className="py-1">
          <ComplianceDocRowItem
            icon={<Soc2 aria-hidden className="size-7 shrink-0" />}
            label={t(($) => $['compliance.soc2Type1'], { ns: 'common' })}
            docName={DocName.SOC2_Type_I}
          />
          <ComplianceDocRowItem
            icon={<Soc2 aria-hidden className="size-7 shrink-0" />}
            label={t(($) => $['compliance.soc2Type2'], { ns: 'common' })}
            docName={DocName.SOC2_Type_II}
          />
          <ComplianceDocRowItem
            icon={<Iso aria-hidden className="size-7 shrink-0" />}
            label={t(($) => $['compliance.iso27001'], { ns: 'common' })}
            docName={DocName.ISO_27001}
          />
          <ComplianceDocRowItem
            icon={<Gdpr aria-hidden className="size-7 shrink-0" />}
            label={t(($) => $['compliance.gdpr'], { ns: 'common' })}
            docName={DocName.GDPR}
          />
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
