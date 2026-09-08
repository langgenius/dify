import { cn } from '@langgenius/dify-ui/cn'
import { DialogClose, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { DifyLogo } from '../../base/logo/dify-logo'
import styles from './header.module.css'

const Header = () => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-26.25 w-full justify-center px-10">
      <div className="relative flex max-w-[1680px] grow flex-col justify-end gap-y-1 border-x border-divider-accent p-6 pt-8">
        <DialogClose
          render={
            <IconButton
              variant="secondary"
              size="xl"
              className="fixed inset-e-5.5 top-6 z-10 rounded-full min-[1760px]:absolute min-[1760px]:-inset-e-4.75 min-[1760px]:top-auto min-[1760px]:bottom-10.25"
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            >
              <span aria-hidden="true" className="i-ri-close-line size-5" />
            </IconButton>
          }
        />
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
      </div>
    </div>
  )
}

export default React.memo(Header)
