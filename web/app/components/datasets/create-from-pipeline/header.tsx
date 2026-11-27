import { cn } from '@langgenius/dify-ui/cn'
import { iconButtonVariants } from '@langgenius/dify-ui/icon-button'
import { RiArrowLeftLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'

const Header = ({ backLinkRef }: { backLinkRef: React.RefObject<HTMLAnchorElement | null> }) => {
  const { t } = useTranslation(['datasetPipeline'])

  return (
    <div className="relative flex px-16 pt-5 pb-2 system-md-semibold text-text-primary">
      <span>{t(($) => $['creation.backToKnowledge'], { ns: 'datasetPipeline' })}</span>
      <Link
        ref={backLinkRef}
        aria-label={t(($) => $['creation.backToKnowledge'], { ns: 'datasetPipeline' })}
        className={cn(
          iconButtonVariants({ variant: 'secondary-accent', size: 'xl' }),
          'absolute inset-s-5 bottom-0 rounded-full',
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
