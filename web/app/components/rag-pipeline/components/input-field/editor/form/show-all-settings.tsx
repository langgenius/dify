import { useTranslation } from 'react-i18next'
import { RiArrowRightSLine } from '@remixicon/react'

type ShowAllSettingsProps = {
  description: string
  handleShowAllSettings: () => void
}

const ShowAllSettings = ({
  description,
  handleShowAllSettings,
}: ShowAllSettingsProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex cursor-pointer items-center gap-x-4' onClick={handleShowAllSettings}>
      <div className='flex grow flex-col'>
        <span className='system-sm-medium flex min-h-6 items-center text-text-secondary'>
          {t('appDebug.variableConfig.showAllSettings')}
        </span>
        <span className='body-xs-regular pb-0.5 text-text-tertiary first-letter:capitalize'>
          {description}
        </span>
      </div>
      <RiArrowRightSLine className='h-4 w-4 shrink-0 text-text-secondary' />
    </div>
  )
}

export default ShowAllSettings
