import { cn } from '@langgenius/dify-ui/cn'
import { DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { DifyLogo } from '../../base/logo/dify-logo'
import styles from './header.module.css'

const Header = () => {
  const { t } = useTranslation(['billing'])

  return (
    <div className="flex min-h-26.25 w-full justify-center px-3 xl:px-10">
      <div className="relative flex max-w-[1680px] min-w-0 grow flex-col justify-end gap-y-1 border-x border-divider-accent p-3 pt-8 xl:p-6 xl:pt-8">
        <div className="flex flex-wrap items-end pr-14">
          <div aria-hidden="true" className="py-1.25">
            <DifyLogo alt="" className="h-6.75 w-15" />
          </div>
          <DialogTitle
            className={cn(
              'min-w-0 bg-billing-plan-title-bg bg-clip-text px-1.5 text-[37px] leading-[1.2] wrap-anywhere text-transparent',
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
