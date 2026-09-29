import type { FC } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiLineHeight } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type DisplayToggleProps = {
  isCollapsed: boolean
  toggleCollapsed: () => void
}

const DisplayToggle: FC<DisplayToggleProps> = ({ isCollapsed, toggleCollapsed }) => {
  const { t } = useTranslation(['datasetDocuments'])
  const label = isCollapsed
    ? t(($) => $['segment.expandChunks'], { ns: 'datasetDocuments' })
    : t(($) => $['segment.collapseChunks'], { ns: 'datasetDocuments' })

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className="flex items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg p-2 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]"
            onClick={toggleCollapsed}
          >
            {isCollapsed ? (
              <RiLineHeight className="size-4 text-components-button-secondary-text" />
            ) : (
              <span
                aria-hidden
                className="i-custom-vender-knowledge-collapse size-4 text-components-button-secondary-text"
              />
            )}
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export default React.memo(DisplayToggle)
