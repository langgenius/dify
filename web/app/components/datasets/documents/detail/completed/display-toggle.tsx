import React, { type FC } from 'react'
import { useTranslation } from 'react-i18next'
import { RiLineHeight } from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import { Collapse } from '@/app/components/base/icons/src/public/knowledge'

type DisplayToggleProps = {
  isCollapsed: boolean
  toggleCollapsed: () => void
}

const DisplayToggle: FC<DisplayToggleProps> = ({
  isCollapsed,
  toggleCollapsed,
}) => {
  const { t } = useTranslation()

  return (
    <Tooltip
      popupContent={isCollapsed ? t('datasetDocuments.segment.expandChunks') : t('datasetDocuments.segment.collapseChunks')}
      popupClassName='text-text-secondary system-xs-medium border-[0.5px] border-components-panel-border'
    >
      <button
        type='button'
        className='bg-components-button-secondary-bg border-components-button-secondary-border shadow-xs shadow-shadow-shadow-3 flex items-center
        justify-center rounded-lg border-[0.5px] p-2 backdrop-blur-[5px]'
        onClick={toggleCollapsed}
      >
        {
          isCollapsed
            ? <RiLineHeight className='text-components-button-secondary-text h-4 w-4' />
            : <Collapse className='text-components-button-secondary-text h-4 w-4' />
        }
      </button>

    </Tooltip>
  )
}

export default React.memo(DisplayToggle)
