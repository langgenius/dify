import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react'
import { RiArrowDownCircleLine, RiArrowRightSLine, RiVerifiedBadgeLine } from '@remixicon/react'
import type { FC, MouseEvent } from 'react'
import { Fragment, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import PremiumBadge from '../../base/premium-badge'
import SparklesSoft from '../../base/icons/src/public/common/SparklesSoft'
import Button from '../../base/button'
import Soc2 from '../../base/icons/src/public/common/Soc2'
import Iso from '../../base/icons/src/public/common/Iso'
import Gdpr from '../../base/icons/src/public/common/Gdpr'
import Toast from '../../base/toast'
import Tooltip from '../../base/tooltip'
import cn from '@/utils/classnames'
import { useProviderContext } from '@/context/provider-context'
import { Plan } from '@/app/components/billing/type'
import { useModalContext } from '@/context/modal-context'
import { getDocDownloadUrl } from '@/service/common'

enum DocName {
  SOC2_Type_I = 'SOC2_Type_I',
  SOC2_Type_II = 'SOC2_Type_II',
  ISO_27001 = 'ISO_27001',
  GDPR = 'GDPR',
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
      setShowAccountSettingModal({ payload: 'billing' })
  }, [isFreePlan, setShowAccountSettingModal, setShowPricingModal])

  const { isPending, mutate: downloadCompliance } = useMutation({
    mutationKey: ['downloadCompliance', doc_name],
    mutationFn: async () => {
      try {
        const ret = await getDocDownloadUrl(doc_name)
        const a = document.createElement('a')
        a.href = ret.url
        a.click()
        Toast.notify({
          type: 'success',
          message: t('common.operation.downloadSuccess'),
        })
      }
      catch (error) {
        console.error(error)
        Toast.notify({
          type: 'error',
          message: t('common.operation.downloadFailed'),
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
    return <Button loading={isPending} disabled={isPending} size='small' variant='secondary' className='flex items-center gap-[1px]' onClick={handleDownloadClick}>
      <RiArrowDownCircleLine className='size-[14px] text-components-button-secondary-text-disabled' />
      <span className='system-xs-medium px-[3px] text-components-button-secondary-text'>{t('common.operation.download')}</span>
    </Button>
  }
  const upgradeTooltip: Record<Plan, string> = {
    [Plan.sandbox]: t('common.compliance.sandboxUpgradeTooltip'),
    [Plan.professional]: t('common.compliance.professionalUpgradeTooltip'),
    [Plan.team]: '',
    [Plan.enterprise]: '',
  }
  return <Tooltip asChild={false} popupContent={upgradeTooltip[plan.type]}>
    <PremiumBadge color='blue' allowHover={true} onClick={handlePlanClick}>
      <SparklesSoft className='flex h-3.5 w-3.5 items-center py-[1px] pl-[3px] text-components-premium-badge-indigo-text-stop-0' />
      <div className='system-xs-medium'>
        <span className='p-1'>
          {t('billing.upgradeBtn.encourageShort')}
        </span>
      </div>
    </PremiumBadge>
  </Tooltip>
}

export default function Compliance() {
  const itemClassName = `
  flex items-center w-full h-10 pl-1 pr-2 py-1 text-text-secondary system-md-regular
  rounded-lg hover:bg-state-base-hover gap-1
`
  const { t } = useTranslation()

  return <Menu as="div" className="relative h-full w-full">
    {
      ({ open }) => (
        <>
          <MenuButton className={
            cn('group flex h-9 w-full items-center gap-1 rounded-lg py-2 pl-3 pr-2 hover:bg-state-base-hover',
              open && 'bg-state-base-hover',
            )}>
            <RiVerifiedBadgeLine className='size-4 shrink-0 text-text-tertiary' />
            <div className='system-md-regular grow px-1 text-left text-text-secondary'>{t('common.userProfile.compliance')}</div>
            <RiArrowRightSLine className='size-[14px] shrink-0 text-text-tertiary' />
          </MenuButton>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            <MenuItems
              className={cn(
                `absolute top-[1px] z-10 max-h-[70vh] w-[337px] origin-top-right -translate-x-full divide-y divide-divider-subtle overflow-y-scroll
                rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px] focus:outline-none
              `,
              )}
            >
              <div className="px-1 py-1">
                <MenuItem>
                  <div
                    className={cn(itemClassName, 'group justify-between',
                      'data-[active]:bg-state-base-hover',
                    )}>
                    <Soc2 className='size-7 shrink-0' />
                    <div className='system-md-regular grow truncate px-1 text-text-secondary'>{t('common.compliance.soc2Type1')}</div>
                    <UpgradeOrDownload doc_name={DocName.SOC2_Type_I} />
                  </div>
                </MenuItem>
                <MenuItem>
                  <div
                    className={cn(itemClassName, 'group justify-between',
                      'data-[active]:bg-state-base-hover',
                    )}>
                    <Soc2 className='size-7 shrink-0' />
                    <div className='system-md-regular grow truncate px-1 text-text-secondary'>{t('common.compliance.soc2Type2')}</div>
                    <UpgradeOrDownload doc_name={DocName.SOC2_Type_II} />
                  </div>
                </MenuItem>
                <MenuItem>
                  <div
                    className={cn(itemClassName, 'group justify-between',
                      'data-[active]:bg-state-base-hover',
                    )}>
                    <Iso className='size-7 shrink-0' />
                    <div className='system-md-regular grow truncate px-1 text-text-secondary'>{t('common.compliance.iso27001')}</div>
                    <UpgradeOrDownload doc_name={DocName.ISO_27001} />
                  </div>
                </MenuItem>
                <MenuItem>
                  <div
                    className={cn(itemClassName, 'group justify-between',
                      'data-[active]:bg-state-base-hover',
                    )}>
                    <Gdpr className='size-7 shrink-0' />
                    <div className='system-md-regular grow truncate px-1 text-text-secondary'>{t('common.compliance.gdpr')}</div>
                    <UpgradeOrDownload doc_name={DocName.GDPR} />
                  </div>
                </MenuItem>
              </div>
            </MenuItems>
          </Transition>
        </>
      )
    }
  </Menu>
}
