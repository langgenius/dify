import type { CSSProperties } from 'react'
import { DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import { basePath } from '@/utils/var'
import styles from './pricing.module.css'

export default function Header() {
  const { t } = useTranslation(['billing'])

  return (
    <div className="min-h-16 pe-11">
      <DialogTitle>
        <span className="flex items-center gap-2 text-2xl leading-[37px] font-normal">
          <span
            role="img"
            aria-label="Dify"
            style={
              {
                '--pricing-logo-light': `url("${basePath}/logo/logo.svg")`,
              } as CSSProperties
            }
            className={`${styles.logo} h-[27px] w-15 bg-contain bg-center bg-no-repeat`}
          />
          <span>Cloud</span>
        </span>
      </DialogTitle>
      <DialogDescription>
        <span className="mt-[3px] block font-[PricingInter,sans-serif] text-base leading-6 text-text-tertiary">
          {t(($) => $['plansCommon.title.description'])}
        </span>
      </DialogDescription>
    </div>
  )
}
