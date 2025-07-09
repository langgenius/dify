import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import React from 'react'
import { useTranslation } from 'react-i18next'
import MenuItem from './menu-item'
import { RiEditLine } from '@remixicon/react'
import { noop } from 'lodash-es'

const Menu = () => {
  const { t } = useTranslation()
  const dataset = useDatasetDetailContextWithSelector(state => state.dataset)

  return (
    <div className='flex w-[200px] flex-col rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]'>
      <div className='flex flex-col p-1'>
        <MenuItem Icon={RiEditLine} name={t('common.operation.edit')} handleClick={noop} />
      </div>
    </div>
  )
}

export default React.memo(Menu)
