import { DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import styles from './pricing.module.css'

export default function Header() {
  const { t } = useTranslation(['billing'])

  return (
    <div className={styles.header}>
      <DialogTitle className={styles.title}>
        <img src="/logo/logo.svg" alt="Dify" width={60} height={27} className="dark:hidden" />
        <img
          src="/pricing/logo-dark.svg"
          alt="Dify"
          width={60}
          height={27}
          className="hidden dark:block"
        />
        <span>Cloud</span>
      </DialogTitle>
      <DialogDescription className={styles.description}>
        {t(($) => $['plansCommon.title.description'])}
      </DialogDescription>
    </div>
  )
}
