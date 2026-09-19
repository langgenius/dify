import { cn } from '@langgenius/dify-ui/cn'
import { iconButtonVariants } from '@langgenius/dify-ui/icon-button'
import { RiArrowLeftLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'

const Header = () => {
  const { t } = useTranslation()

  return (
    <div className="relative flex px-16 pt-5 pb-2 system-md-semibold text-text-primary">
      <span>{t(($) => $['creation.backToKnowledge'], { ns: 'datasetPipeline' })}</span>
      <Link
        aria-label={t(($) => $['creation.backToKnowledge'], { ns: 'datasetPipeline' })}
        className={cn(
          iconButtonVariants({ variant: 'secondary-accent', size: 'xl' }),
          'absolute bottom-0 left-5 rounded-full',
        )}
        href="/datasets"
        replace
      >
        <RiArrowLeftLine aria-hidden className="size-5" />
      </Link>
    </div>
  )
}

export default React.memo(Header)
