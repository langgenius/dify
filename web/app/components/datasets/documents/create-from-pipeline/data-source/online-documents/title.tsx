import * as React from 'react'
import { useTranslation } from 'react-i18next'

type TitleProps = {
  name: string
}

const Title = ({ name }: TitleProps) => {
  const { t } = useTranslation()

  return (
    <div className="px-1.25 py-1 system-sm-medium text-text-secondary">
      {t(($) => $['onlineDocument.pageSelectorTitle'], { ns: 'datasetPipeline', name })}
    </div>
  )
}

export default React.memo(Title)
