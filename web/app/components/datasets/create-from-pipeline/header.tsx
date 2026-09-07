import { buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
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
        className={cn(
          buttonVariants({ variant: 'secondary-accent' }),
          'absolute bottom-0 left-5 size-9 rounded-full p-0',
        )}
        href="/datasets"
        replace
      >
        <RiArrowLeftLine className="size-5" />
      </Link>
    </div>
  )
}

export default React.memo(Header)
