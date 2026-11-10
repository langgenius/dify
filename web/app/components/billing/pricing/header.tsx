import { DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import styles from './pricing.module.css'

export default function Header() {
  const { t } = useTranslation(['billing'])

  return (
    <div className={styles.header}>
      <DialogTitle className={styles.title}>
        <span role="img" aria-label="Dify" className={styles.logo} />
        <span>Cloud</span>
      </DialogTitle>
      <DialogDescription className={styles.description}>
        {t(($) => $['plansCommon.title.description'])}
      </DialogDescription>
    </div>
  )
}
