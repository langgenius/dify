import React, { type FC } from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'

type FilterSwitchProps = {
  enabled: boolean
  handleSwitch: (value: boolean) => void
}

const FilterSwitch: FC<FilterSwitchProps> = ({
  enabled,
  handleSwitch,
}) => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center p-1'>
      <div className='flex w-full items-center gap-x-1 px-2 py-1.5'>
        <div className='system-md-regular flex-1 px-1 text-text-secondary'>
          {t('workflow.versionHistory.filter.onlyShowNamedVersions')}
        </div>
        <Switch
          defaultValue={enabled}
          onChange={v => handleSwitch(v)}
          size='md'
          className='shrink-0'
        />
      </div>
    </div>
  )
}

export default React.memo(FilterSwitch)
