import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { DialogDescription, DialogTitle } from '@/app/components/base/ui/dialog'
import Button from '../../base/button'
import DifyLogo from '../../base/logo/dify-logo'

type HeaderProps = {
  onClose: () => void
}

const Header = ({
  onClose,
}: HeaderProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-[105px] w-full justify-center px-10">
      <div className="relative flex max-w-[1680px] grow flex-col justify-end gap-y-1 border-x border-divider-accent p-6 pt-8">
        <div className="flex items-end">
          <div className="py-[5px]">
            <DifyLogo className="h-[27px] w-[60px]" />
          </div>
          <DialogTitle className="m-0 bg-billing-plan-title-bg bg-clip-text px-1.5 font-instrument text-[37px] italic leading-[1.2] text-transparent">
            {t('plansCommon.title.plans', { ns: 'billing' })}
          </DialogTitle>
        </div>
        <DialogDescription className="m-0 text-text-tertiary system-sm-regular">
          {t('plansCommon.title.description', { ns: 'billing' })}
        </DialogDescription>
        <Button
          variant="secondary"
          className="absolute bottom-[40.5px] right-[-18px] z-10 size-9 rounded-full p-2"
          onClick={onClose}
        >
          <span aria-hidden="true" className="i-ri-close-line size-5" />
        </Button>
      </div>
    </div>
  )
}

export default React.memo(Header)
