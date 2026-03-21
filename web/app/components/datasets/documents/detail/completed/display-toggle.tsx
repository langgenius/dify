import type { FC } from 'react'
import { RiLineHeight } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Collapse } from '@/app/components/base/icons/src/vender/knowledge'
import Tooltip from '@/app/components/base/tooltip'

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
      popupContent={isCollapsed ? t('segment.expandChunks', { ns: 'datasetDocuments' }) : t('segment.collapseChunks', { ns: 'datasetDocuments' })}
      popupClassName="text-text-secondary system-xs-medium border-[0.5px] border-components-panel-border"
    >
      <button
        type="button"
        className="flex items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border
        bg-components-button-secondary-bg p-2 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]"
        onClick={toggleCollapsed}
      >
        {
          isCollapsed
            ? <RiLineHeight className="h-4 w-4 text-components-button-secondary-text" />
            : <Collapse className="h-4 w-4 text-components-button-secondary-text" />
        }
      </button>

    </Tooltip>
  )
}

export default React.memo(DisplayToggle)
