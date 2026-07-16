import type { Hotkey } from '@tanstack/react-hotkeys'
import { Button } from '@langgenius/dify-ui/button'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { formatForDisplay, useHotkey } from '@tanstack/react-hotkeys'
import { useTranslation } from 'react-i18next'
import { ChunkingMode } from '@/models/datasets'
import { useDocumentContext } from '../../context'

const CANCEL_HOTKEY = 'Escape' satisfies Hotkey
const SAVE_HOTKEY = 'Mod+S' satisfies Hotkey

type ActionButtonsProps = {
  handleCancel: () => void
  handleSave: () => void
  loading: boolean
  actionType?: 'edit' | 'add'
  handleRegeneration?: () => void
  isChildChunk?: boolean
  showRegenerationButton?: boolean
}

export function ActionButtons({
  handleCancel,
  handleSave,
  loading,
  actionType = 'edit',
  handleRegeneration,
  isChildChunk = false,
  showRegenerationButton = true,
}: ActionButtonsProps) {
  const { t } = useTranslation()
  const docForm = useDocumentContext((s) => s.docForm)
  const parentMode = useDocumentContext((s) => s.parentMode)

  useHotkey(CANCEL_HOTKEY, (e) => {
    e.preventDefault()
    handleCancel()
  })

  useHotkey(SAVE_HOTKEY, (e) => {
    e.preventDefault()
    if (loading) return
    handleSave()
  })

  const isParentChildParagraphMode =
    docForm === ChunkingMode.parentChild && parentMode === 'paragraph'

  return (
    <div className="flex items-center gap-x-2">
      <Button onClick={handleCancel}>
        <div className="flex items-center gap-x-1">
          <span className="system-sm-medium text-components-button-secondary-text">
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </span>
          <Kbd>{formatForDisplay(CANCEL_HOTKEY)}</Kbd>
        </div>
      </Button>
      {isParentChildParagraphMode &&
      actionType === 'edit' &&
      !isChildChunk &&
      showRegenerationButton ? (
        <Button onClick={handleRegeneration} disabled={loading}>
          <span className="system-sm-medium text-components-button-secondary-text">
            {t(($) => $['operation.saveAndRegenerate'], { ns: 'common' })}
          </span>
        </Button>
      ) : null}
      <Button variant="primary" onClick={handleSave} disabled={loading}>
        <div className="flex items-center gap-x-1">
          <span className="text-components-button-primary-text">
            {t(($) => $['operation.save'], { ns: 'common' })}
          </span>
          <KbdGroup>
            {SAVE_HOTKEY.split('+').map((key) => (
              <Kbd key={key} color="white">
                {formatForDisplay(key)}
              </Kbd>
            ))}
          </KbdGroup>
        </div>
      </Button>
    </div>
  )
}
