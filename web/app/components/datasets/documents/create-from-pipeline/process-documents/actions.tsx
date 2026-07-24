import { RiArrowLeftLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

type ActionsProps = {
  onBack: () => void
  runDisabled?: boolean
  onProcess: () => void
}

const Actions = ({
  onBack,
  runDisabled,
  onProcess,
}: ActionsProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-between">
      <Button
        variant="secondary"
        onClick={onBack}
        className="gap-x-0.5"
      >
        <RiArrowLeftLine className="size-4" />
        <span className="px-0.5">{t('operations.dataSource', { ns: 'datasetPipeline' })}</span>
      </Button>
      <Button
        variant="primary"
        disabled={runDisabled}
        onClick={onProcess}
      >
        {t('operations.saveAndProcess', { ns: 'datasetPipeline' })}
      </Button>
    </div>
  )
}

export default React.memo(Actions)
