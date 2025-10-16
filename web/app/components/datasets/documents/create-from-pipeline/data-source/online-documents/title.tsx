import React from 'react'
import { useTranslation } from 'react-i18next'

type TitleProps = {
  name: string
}

const Title = ({
  name,
}: TitleProps) => {
  const { t } = useTranslation()

  return (
    <div className='system-sm-medium px-[5px] py-1 text-text-secondary'>
      {t('datasetPipeline.onlineDocument.pageSelectorTitle', { name })}
    </div>
  )
}

export default React.memo(Title)
