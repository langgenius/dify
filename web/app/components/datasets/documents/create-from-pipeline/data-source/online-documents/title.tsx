import * as React from 'react'
import { useTranslation } from 'react-i18next'

type TitleProps = {
  name: string
}

const Title = ({
  name,
}: TitleProps) => {
  const { t } = useTranslation()

  return (
    <div className="px-[5px] py-1 text-text-secondary system-sm-medium">
      {t('onlineDocument.pageSelectorTitle', { ns: 'datasetPipeline', name })}
    </div>
  )
}

export default React.memo(Title)
