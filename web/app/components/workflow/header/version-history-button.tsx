import React, { type FC, useCallback } from 'react'
import { RiHistoryLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useKeyPress } from 'ahooks'
import Button from '../../base/button'
import Tooltip from '../../base/tooltip'
import { getKeyboardKeyCodeBySystem } from '../utils'

type VersionHistoryButtonProps = {
  onClick: () => Promise<unknown> | unknown
}

const VERSION_HISTORY_SHORTCUT = ['⌘', '⇧', 'H']

const PopupContent = React.memo(() => {
  const { t } = useTranslation()
  return (
    <div className='flex items-center gap-x-1'>
      <div className='text-text-secondary system-xs-medium px-0.5'>
        {t('workflow.common.versionHistory')}
      </div>
      <div className='flex items-center gap-x-0.5'>
        {VERSION_HISTORY_SHORTCUT.map(key => (
          <span
            key={key}
            className='rounded-[4px] bg-components-kbd-bg-white text-text-tertiary system-kbd px-[1px]'
          >
            {key}
          </span>
        ))}
      </div>
    </div>
  )
})

PopupContent.displayName = 'PopupContent'

const VersionHistoryButton: FC<VersionHistoryButtonProps> = ({
  onClick,
}) => {
  const handleViewVersionHistory = useCallback(async () => {
    await onClick?.()
  }, [onClick])

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.shift.h`, (e) => {
    e.preventDefault()
    handleViewVersionHistory()
  }
  , { exactMatch: true, useCapture: true })

  return <Tooltip
    popupContent={<PopupContent />}
    noDecoration
    popupClassName='rounded-lg border-[0.5px] border-components-panel-border bg-components-tooltip-bg
    shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px] p-1.5'
  >
    <Button
      className={'p-2'}
      onClick={handleViewVersionHistory}
    >
      <RiHistoryLine className='w-4 h-4 text-components-button-secondary-text' />
    </Button>
  </Tooltip>
}

export default VersionHistoryButton
