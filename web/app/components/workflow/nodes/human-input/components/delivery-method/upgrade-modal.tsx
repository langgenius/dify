import {
  RiMailSendFill,
} from '@remixicon/react'
import { noop } from 'es-toolkit/compat'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { SparklesSoft } from '@/app/components/base/icons/src/public/common'
import Modal from '@/app/components/base/modal'
import PremiumBadge from '@/app/components/base/premium-badge'
import { useModalContextSelector } from '@/context/modal-context'
import { cn } from '@/utils/classnames'

type UpgradeModalProps = {
  isShow: boolean
  onClose: () => void
}

const UpgradeModal: React.FC<UpgradeModalProps> = ({
  isShow,
  onClose,
}) => {
  const { t } = useTranslation()
  const setShowPricingModal = useModalContextSelector(s => s.setShowPricingModal)

  return (
    <Modal
      isShow={isShow}
      onClose={noop}
      className="relative !w-[580px] !max-w-[580px] !p-8"
    >
      <div className="pb-6">
        <div
          className={cn(
            'mb-6 inline-flex rounded-xl border border-divider-regular bg-util-colors-blue-brand-blue-brand-500 p-2',
          )}
        >
          <RiMailSendFill className="h-6 w-6 text-text-primary-on-surface" />
        </div>
        <p
          className="title-3xl-semi-bold bg-[linear-gradient(271deg,_var(--components-input-border-active-prompt-1,_#155AEF)_-12.85%,_var(--components-input-border-active-prompt-2,_#0BA5EC)_95.4%)] bg-clip-text text-transparent"
        >
          {t('nodes.humanInput.deliveryMethod.upgradeTip', { ns: 'workflow' })}
        </p>
        <p className="system-md-regular mt-2 text-text-tertiary">
          {t('nodes.humanInput.deliveryMethod.upgradeTipContent', { ns: 'workflow' })}
        </p>
      </div>
      <div className="flex justify-end pt-5">
        <Button
          className="w-[72px]"
          onClick={onClose}
        >
          {t('nodes.humanInput.deliveryMethod.upgradeTipHide', { ns: 'workflow' })}
        </Button>
        <PremiumBadge
          size="custom"
          color="blue"
          allowHover={true}
          className="ml-3 h-8 w-[93px]"
          onClick={() => {
            setShowPricingModal()
          }}
        >
          <SparklesSoft className="flex h-3.5 w-3.5 items-center py-[1px] pl-[3px] text-components-premium-badge-indigo-text-stop-0" />
          <div className="system-sm-medium">
            <span className="p-1">
              {t('upgradeBtn.encourageShort', { ns: 'billing' })}
            </span>
          </div>
        </PremiumBadge>
      </div>
    </Modal>
  )
}

export default UpgradeModal
