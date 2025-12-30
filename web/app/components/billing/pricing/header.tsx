import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
          <span className="bg-billing-plan-title-bg bg-clip-text px-1.5 font-instrument text-[37px] italic leading-[1.2] text-transparent">
            {t('plansCommon.title.plans', { ns: 'billing' })}
          </span>
        </div>
        <p className="system-sm-regular text-text-tertiary">
          {t('plansCommon.title.description', { ns: 'billing' })}
        </p>
        <Button
          variant="secondary"
          className="absolute bottom-[40.5px] right-[-18px] z-10 size-9 rounded-full p-2"
          onClick={onClose}
        >
          <RiCloseLine className="size-5" />
        </Button>
      </div>
    </div>
  )
}

export default React.memo(Header)
