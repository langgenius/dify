import React from 'react'
import { withForm } from '@/app/components/base/form'
import { useStore } from '@tanstack/react-form'
import { useHiddenFieldNames } from './hooks'
import { useTranslation } from 'react-i18next'
import { RiArrowRightSLine } from '@remixicon/react'

type ShowAllSettingsProps = {
  initialData?: Record<string, any>
  handleShowAllSettings: () => void
}

const ShowAllSettings = ({
  initialData,
  handleShowAllSettings,
}: ShowAllSettingsProps) => withForm({
  defaultValues: initialData,
  render: function Render({
    form,
  }) {
    const { t } = useTranslation()
    const type = useStore(form.store, state => state.values.type)

    const hiddenFieldNames = useHiddenFieldNames(type)

    return (
      <div className='flex cursor-pointer items-center gap-x-4' onClick={handleShowAllSettings}>
        <div className='flex grow flex-col'>
          <span className='system-sm-medium flex min-h-6 items-center text-text-secondary'>
            {t('appDebug.variableConfig.showAllSettings')}
          </span>
          <span className='body-xs-regular pb-0.5 text-text-tertiary first-letter:capitalize'>
            {hiddenFieldNames}
          </span>
        </div>
        <RiArrowRightSLine className='h-4 w-4 shrink-0 text-text-secondary' />
      </div>
    )
  },
})

export default ShowAllSettings
