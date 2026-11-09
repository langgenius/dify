import { DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import styles from './pricing.module.css'

export default function Header() {
  const { t } = useTranslation(['billing'])

  return (
    <div className={styles.header}>
      <DialogTitle className={styles.title}>
        <img src="/logo/logo.svg" alt="Dify" width={60} height={27} />
        <span>Cloud</span>
      </DialogTitle>
      <DialogDescription className={styles.description}>
        {t(($) => $['plansCommon.title.description'])}
      </DialogDescription>
    </div>
  )
}
