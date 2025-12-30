import { RiArrowLeftLine } from '@remixicon/react'
import Link from 'next/link'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../../base/button'

const Header = () => {
  const { t } = useTranslation()

  return (
    <div className="system-md-semibold relative flex px-16 pb-2 pt-5 text-text-primary">
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
          <RiArrowLeftLine className="size-5 " />
        </Button>
      </Link>
    </div>
  )
}

export default React.memo(Header)
