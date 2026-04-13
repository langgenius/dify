import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { DialogDescription, DialogTitle } from '@/app/components/base/ui/dialog'
import { cn } from '@/utils/classnames'
import Button from '../../base/button'
import DifyLogo from '../../base/logo/dify-logo'
import styles from './header.module.css'

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
          <div aria-hidden="true" className="py-[5px]">
            <DifyLogo className="h-[27px] w-[60px]" />
          </div>
          <DialogTitle
            className={cn(
              'bg-billing-plan-title-bg bg-clip-text px-1.5 text-[37px] leading-[1.2] text-transparent',
              styles.instrumentSerif,
            )}
          >
            {t('plansCommon.title.plans', { ns: 'billing' })}
          </DialogTitle>
        </div>
        <DialogDescription className="text-text-tertiary system-sm-regular">
          {t('plansCommon.title.description', { ns: 'billing' })}
        </DialogDescription>
        <Button
          variant="secondary"
          className="absolute bottom-[40.5px] right-[-18px] z-10 size-9 rounded-full p-2"
          aria-label={t('operation.close', { ns: 'common' })}
          onClick={onClose}
        >
          <span aria-hidden="true" className="i-ri-close-line size-5" />
        </Button>
      </div>
    </div>
  )
}

export default React.memo(Header)
