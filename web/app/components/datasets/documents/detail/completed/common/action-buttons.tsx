import React, { type FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useKeyPress } from 'ahooks'
import { useDocumentContext } from '../../index'
import Button from '@/app/components/base/button'
import { getKeyboardKeyCodeBySystem, getKeyboardKeyNameBySystem } from '@/app/components/workflow/utils'

type IActionButtonsProps = {
  handleCancel: () => void
  handleSave: () => void
  loading: boolean
  actionType?: 'edit' | 'add'
  handleRegeneration?: () => void
  isChildChunk?: boolean
}

const ActionButtons: FC<IActionButtonsProps> = ({
  handleCancel,
  handleSave,
  loading,
  actionType = 'edit',
  handleRegeneration,
  isChildChunk = false,
}) => {
  const { t } = useTranslation()
  const mode = useDocumentContext(s => s.mode)
  const parentMode = useDocumentContext(s => s.parentMode)

  useKeyPress(['esc'], (e) => {
    e.preventDefault()
    handleCancel()
  })

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.s`, (e) => {
    e.preventDefault()
    if (loading)
      return
    handleSave()
  }
  , { exactMatch: true, useCapture: true })

  const isParentChildParagraphMode = useMemo(() => {
    return mode === 'hierarchical' && parentMode === 'paragraph'
  }, [mode, parentMode])

  return (
    <div className='flex items-center gap-x-2'>
      <Button
        onClick={handleCancel}
      >
        <div className='flex items-center gap-x-1'>
          <span className='text-components-button-secondary-text system-sm-medium'>{t('common.operation.cancel')}</span>
          <span className='px-[1px] bg-components-kbd-bg-gray rounded-[4px] text-text-tertiary system-kbd'>ESC</span>
        </div>
      </Button>
      {(isParentChildParagraphMode && actionType === 'edit' && !isChildChunk)
        ? <Button
          onClick={handleRegeneration}
          disabled={loading}
        >
          <span className='text-components-button-secondary-text system-sm-medium'>
            {t('common.operation.saveAndRegenerate')}
          </span>
        </Button>
        : null
      }
      <Button
        variant='primary'
        onClick={handleSave}
        disabled={loading}
      >
        <div className='flex items-center gap-x-1'>
          <span className='text-components-button-primary-text'>{t('common.operation.save')}</span>
          <div className='flex items-center gap-x-0.5'>
            <span className='w-4 h-4 bg-components-kbd-bg-white rounded-[4px] text-text-primary-on-surface system-kbd capitalize'>{getKeyboardKeyNameBySystem('ctrl')}</span>
            <span className='w-4 h-4 bg-components-kbd-bg-white rounded-[4px] text-text-primary-on-surface system-kbd'>S</span>
          </div>
        </div>
      </Button>
    </div>
  )
}

ActionButtons.displayName = 'ActionButtons'

export default React.memo(ActionButtons)
