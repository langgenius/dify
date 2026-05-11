import { Button } from '@langgenius/dify-ui/button'
import { RiMailSendFill } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { SparklesSoft } from '@/app/components/base/icons/src/public/common'
import { PremiumBadgeButton } from '@/app/components/base/premium-badge'
import { UpgradeModal as BaseUpgradeModal } from '@/app/components/base/upgrade-modal'
import { useModalContextSelector } from '@/context/modal-context'

type UpgradeModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UpgradeModal({
  open,
  onOpenChange,
}: UpgradeModalProps) {
  const { t } = useTranslation()
  const setShowPricingModal = useModalContextSelector(s => s.setShowPricingModal)
  const handleUpgrade = () => {
    setShowPricingModal()
  }

  return (
    <BaseUpgradeModal
      open={open}
      onOpenChange={onOpenChange}
      Icon={RiMailSendFill}
      title={t('nodes.humanInput.deliveryMethod.upgradeTip', { ns: 'workflow' })}
      description={t('nodes.humanInput.deliveryMethod.upgradeTipContent', { ns: 'workflow' })}
      classNames={{
        content: 'max-w-[580px]',
      }}
      footer={(
        <>
          <Button
            className="w-[72px]"
            onClick={() => onOpenChange(false)}
          >
            {t('nodes.humanInput.deliveryMethod.upgradeTipHide', { ns: 'workflow' })}
          </Button>
          <PremiumBadgeButton
            size="custom"
            color="blue"
            className="h-8 w-[93px]"
            onClick={handleUpgrade}
          >
            <SparklesSoft aria-hidden="true" className="flex h-3.5 w-3.5 items-center py-px pl-[3px] text-components-premium-badge-indigo-text-stop-0" />
            <div className="system-sm-medium">
              <span className="p-1">
                {t('upgradeBtn.encourageShort', { ns: 'billing' })}
              </span>
            </div>
          </PremiumBadgeButton>
        </>
      )}
    />
  )
}
