import { cn } from '@langgenius/dify-ui/cn'
import { DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { DifyLogo } from '../../base/logo/dify-logo'
import styles from './header.module.css'

type HeaderProps = {
  onClose: () => void
}

const Header = ({ onClose }: HeaderProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-26.25 w-full justify-center px-10">
      <div className="relative flex max-w-[1680px] grow flex-col justify-end gap-y-1 border-x border-divider-accent p-6 pt-8">
        <div className="flex items-end">
          <div aria-hidden="true" className="py-1.25">
            <DifyLogo alt="" className="h-6.75 w-15" />
          </div>
          <DialogTitle
            className={cn(
              'bg-billing-plan-title-bg bg-clip-text px-1.5 text-[37px] leading-[1.2] text-transparent',
              styles.instrumentSerif,
            )}
          >
            {t(($) => $['plansCommon.title.plans'], { ns: 'billing' })}
          </DialogTitle>
        </div>
        <DialogDescription className="system-sm-regular text-text-tertiary">
          {t(($) => $['plansCommon.title.description'], { ns: 'billing' })}
        </DialogDescription>
        <IconButton
          variant="secondary"
          size="xl"
          className="absolute -right-4.5 bottom-[40.5px] z-10 rounded-full"
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          onClick={onClose}
        >
          <span aria-hidden="true" className="i-ri-close-line size-5" />
        </IconButton>
      </div>
    </div>
  )
}

export default React.memo(Header)
