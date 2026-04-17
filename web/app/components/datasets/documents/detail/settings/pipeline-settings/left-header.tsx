import { RiArrowLeftLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Effect from '@/app/components/base/effect'
import { Button } from '@/app/components/base/ui/button'
import { useRouter } from '@/next/navigation'

type LeftHeaderProps = {
  title: string
}

const LeftHeader = ({
  title,
}: LeftHeaderProps) => {
  const { t } = useTranslation()
  const { back } = useRouter()

  const navigateBack = useCallback(() => {
    back()
  }, [back])

  return (
    <div className="relative flex flex-col gap-y-0.5 pt-4 pb-2">
      <div className="bg-pipeline-add-documents-title-bg bg-clip-text system-2xs-semibold-uppercase text-transparent">
        {title}
      </div>
      <div className="system-md-semibold text-text-primary">
        {t('addDocuments.steps.processDocuments', { ns: 'datasetPipeline' })}
      </div>
      <Button
        variant="secondary-accent"
        className="absolute top-3.5 -left-11 size-9 rounded-full p-0"
        onClick={navigateBack}
        aria-label={t('operation.back', { ns: 'common' })}
      >
        <RiArrowLeftLine className="size-5" />
      </Button>
      <Effect className="top-[-34px] left-8 opacity-20" />
    </div>
  )
}

export default React.memo(LeftHeader)
