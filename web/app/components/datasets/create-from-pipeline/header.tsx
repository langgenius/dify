import { RiArrowLeftLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/app/components/base/ui/button'
import Link from '@/next/link'

const Header = () => {
  const { t } = useTranslation()

  return (
    <div className="relative flex px-16 pt-5 pb-2 system-md-semibold text-text-primary">
      <span>{t('creation.backToKnowledge', { ns: 'datasetPipeline' })}</span>
      <Link
        className="absolute bottom-0 left-5"
        href="/datasets"
        replace
      >
        <Button
          variant="secondary-accent"
          className="size-9 rounded-full p-0"
        >
          <RiArrowLeftLine className="size-5" />
        </Button>
      </Link>
    </div>
  )
}

export default React.memo(Header)
