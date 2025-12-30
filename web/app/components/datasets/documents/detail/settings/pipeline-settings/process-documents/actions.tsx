import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

type ActionsProps = {
  runDisabled?: boolean
  onProcess: () => void
}

const Actions = ({
  onProcess,
  runDisabled,
}: ActionsProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-end">
      <Button
        variant="primary"
        onClick={onProcess}
        disabled={runDisabled}
      >
        {t('operations.saveAndProcess', { ns: 'datasetPipeline' })}
      </Button>
    </div>
  )
}

export default React.memo(Actions)
