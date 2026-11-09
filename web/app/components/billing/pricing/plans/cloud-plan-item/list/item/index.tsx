import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { useId } from 'react'
import styles from '../../../../pricing.module.css'

export function CloudPlanFeature({ label, description }: { label: string; description?: string }) {
  const labelId = useId()

  return (
    <li className={styles.feature}>
      <img src="/pricing/imgDot.svg" alt="" className={styles.featureDot} />
      <span id={labelId} className={styles.featureLabel}>
        {label}
      </span>
      {description && (
        <Infotip>
          <InfotipTrigger
            aria-labelledby={labelId}
            iconVariant="information"
            iconSize="small"
            className={styles.featureInfo}
          />
          <InfotipContent aria-labelledby={labelId} className="max-w-80 whitespace-pre-wrap">
            {description}
          </InfotipContent>
        </Infotip>
      )}
    </li>
  )
}
