import { RiArrowRightSLine } from '@remixicon/react'
import { useStore } from '@tanstack/react-form'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { withForm } from '@/app/components/base/form'
import { useHiddenFieldNames } from './hooks'

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
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-x-4 border-none bg-transparent p-0 text-left"
        onClick={handleShowAllSettings}
      >
        <div className="flex grow flex-col">
          <span className="flex min-h-6 items-center system-sm-medium text-text-secondary">
            {t('variableConfig.showAllSettings', { ns: 'appDebug' })}
          </span>
          <span className="pb-0.5 body-xs-regular text-text-tertiary first-letter:capitalize">
            {hiddenFieldNames}
          </span>
        </div>
        <RiArrowRightSLine className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
      </button>
    )
  },
})

export default ShowAllSettings
