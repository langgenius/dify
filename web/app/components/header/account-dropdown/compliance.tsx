import type { FC, MouseEvent, ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { DropdownMenuGroup, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/app/components/base/ui/dropdown-menu'
import { Plan } from '@/app/components/billing/type'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { getDocDownloadUrl } from '@/service/common'
import { cn } from '@/utils/classnames'
import { downloadUrl } from '@/utils/download'
import Button from '../../base/button'
import Gdpr from '../../base/icons/src/public/common/Gdpr'
import Iso from '../../base/icons/src/public/common/Iso'
import Soc2 from '../../base/icons/src/public/common/Soc2'
import SparklesSoft from '../../base/icons/src/public/common/SparklesSoft'
import PremiumBadge from '../../base/premium-badge'
import Toast from '../../base/toast'
import Tooltip from '../../base/tooltip'

const submenuTriggerClassName = '!mx-0 !h-8 !rounded-lg !px-3 data-[highlighted]:!bg-state-base-hover'
const menuLabelClassName = 'grow px-1 text-text-secondary system-md-regular'
const menuLeadingIconClassName = 'size-4 shrink-0 text-text-tertiary'
const menuTrailingIconClassName = 'size-[14px] shrink-0 text-text-tertiary'
const complianceRowClassName = 'mx-0 flex h-10 w-full items-center gap-1 rounded-lg py-1 pl-1 pr-2 text-text-secondary system-md-regular'

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

type UpgradeOrDownloadProps = {
  doc_name: DocName
}

const UpgradeOrDownload: FC<UpgradeOrDownloadProps> = ({ doc_name }) => {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const { setShowPricingModal, setShowAccountSettingModal } = useModalContext()
  const isFreePlan = plan.type === Plan.sandbox

  const handlePlanClick = useCallback(() => {
    if (isFreePlan)
      setShowPricingModal()
    else
      setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.BILLING })
  }, [isFreePlan, setShowAccountSettingModal, setShowPricingModal])

  const { isPending, mutate: downloadCompliance } = useMutation({
    mutationKey: ['downloadCompliance', doc_name],
    mutationFn: async () => {
      try {
        const ret = await getDocDownloadUrl(doc_name)
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

  const isCurrentPlanCanDownload = whichPlanCanDownloadCompliance[doc_name].includes(plan.type)
  const handleDownloadClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    downloadCompliance()
  }, [downloadCompliance])
  if (isCurrentPlanCanDownload) {
    return (
      <Button loading={isPending} disabled={isPending} size="small" variant="secondary" className="flex items-center gap-[1px]" onClick={handleDownloadClick}>
        <span aria-hidden className="i-ri-arrow-down-circle-line size-[14px] text-components-button-secondary-text-disabled" />
        <span className="px-[3px] text-components-button-secondary-text system-xs-medium">{t('operation.download', { ns: 'common' })}</span>
      </Button>
    )
  }
  const upgradeTooltip: Record<Plan, string> = {
    [Plan.sandbox]: t('compliance.sandboxUpgradeTooltip', { ns: 'common' }),
    [Plan.professional]: t('compliance.professionalUpgradeTooltip', { ns: 'common' }),
    [Plan.team]: '',
    [Plan.enterprise]: '',
  }
  return (
    <Tooltip asChild={false} popupContent={upgradeTooltip[plan.type]}>
      <PremiumBadge color="blue" allowHover={true} onClick={handlePlanClick}>
        <SparklesSoft className="flex h-3.5 w-3.5 items-center py-[1px] pl-[3px] text-components-premium-badge-indigo-text-stop-0" />
        <div className="system-xs-medium">
          <span className="p-1">
            {t('upgradeBtn.encourageShort', { ns: 'billing' })}
          </span>
        </div>
      </PremiumBadge>
    </Tooltip>
  )
}

type ComplianceDocRowProps = {
  icon: ReactNode
  label: ReactNode
  docName: DocName
}

function ComplianceDocRow({
  icon,
  label,
  docName,
}: ComplianceDocRowProps) {
  return (
    <div className={cn(complianceRowClassName, 'justify-between')}>
      {icon}
      <div className="grow truncate px-1 text-text-secondary system-md-regular">{label}</div>
      <UpgradeOrDownload doc_name={docName} />
    </div>
  )
}

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
        className="!z-20"
        popupClassName="!w-[337px] !max-h-[70vh] !overflow-y-auto !divide-y !divide-divider-subtle !rounded-xl !bg-components-panel-bg-blur !py-0 !shadow-lg !backdrop-blur-sm"
      >
        <DropdownMenuGroup className="p-1">
          <ComplianceDocRow
            icon={<Soc2 aria-hidden className="size-7 shrink-0" />}
            label={t('compliance.soc2Type1', { ns: 'common' })}
            docName={DocName.SOC2_Type_I}
          />
          <ComplianceDocRow
            icon={<Soc2 aria-hidden className="size-7 shrink-0" />}
            label={t('compliance.soc2Type2', { ns: 'common' })}
            docName={DocName.SOC2_Type_II}
          />
          <ComplianceDocRow
            icon={<Iso aria-hidden className="size-7 shrink-0" />}
            label={t('compliance.iso27001', { ns: 'common' })}
            docName={DocName.ISO_27001}
          />
          <ComplianceDocRow
            icon={<Gdpr aria-hidden className="size-7 shrink-0" />}
            label={t('compliance.gdpr', { ns: 'common' })}
            docName={DocName.GDPR}
          />
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
