import type { FC } from 'react'
import { useKeyPress } from 'ahooks'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import ShortcutsName from '@/app/components/workflow/shortcuts-name'
import { getKeyboardKeyCodeBySystem } from '@/app/components/workflow/utils'
import { ChunkingMode } from '@/models/datasets'
import { useDocumentContext } from '../../context'

type IActionButtonsProps = {
  handleCancel: () => void
  handleSave: () => void
  loading: boolean
  actionType?: 'edit' | 'add'
  handleRegeneration?: () => void
  isChildChunk?: boolean
  showRegenerationButton?: boolean
}

const ActionButtons: FC<IActionButtonsProps> = ({
  handleCancel,
  handleSave,
  loading,
  actionType = 'edit',
  handleRegeneration,
  isChildChunk = false,
  showRegenerationButton = true,
}) => {
  const { t } = useTranslation()
  const docForm = useDocumentContext(s => s.docForm)
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
  }, { exactMatch: true, useCapture: true })

  const isParentChildParagraphMode = useMemo(() => {
    return docForm === ChunkingMode.parentChild && parentMode === 'paragraph'
  }, [docForm, parentMode])

  return (
    <div className="flex items-center gap-x-2">
      <Button
        onClick={handleCancel}
      >
        <div className="flex items-center gap-x-1">
          <span className="system-sm-medium text-components-button-secondary-text">{t('operation.cancel', { ns: 'common' })}</span>
          <ShortcutsName keys={['ESC']} textColor="secondary" />
        </div>
      </Button>
      {(isParentChildParagraphMode && actionType === 'edit' && !isChildChunk && showRegenerationButton)
        ? (
            <Button
              onClick={handleRegeneration}
              disabled={loading}
            >
              <span className="system-sm-medium text-components-button-secondary-text">
                {t('operation.saveAndRegenerate', { ns: 'common' })}
              </span>
            </Button>
          )
        : null}
      <Button
        variant="primary"
        onClick={handleSave}
        disabled={loading}
      >
        <div className="flex items-center gap-x-1">
          <span className="text-components-button-primary-text">{t('operation.save', { ns: 'common' })}</span>
          <ShortcutsName keys={['ctrl', 'S']} bgColor="white" />
        </div>
      </Button>
    </div>
  )
}

ActionButtons.displayName = 'ActionButtons'

export default React.memo(ActionButtons)
