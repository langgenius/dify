import { IconButton } from '@langgenius/dify-ui/icon-button'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { openGotoAnythingDialog } from '@/app/components/goto-anything/dialog-handle'
import TipPopup from '../operator/tip-popup'

const NodeSearchButton = () => {
  const { t } = useTranslation()
  const label = t(($) => $['gotoAnything.actions.searchWorkflowNodesDesc'], { ns: 'app' })

  const handleClick = () => {
    openGotoAnythingDialog('@node ')
  }

  return (
    <TipPopup title={label}>
      <IconButton
        aria-label={label}
        size="lg"
        variant="ghost"
        className="rounded-md"
        onClick={handleClick}
      >
        <span
          aria-hidden
          className="i-ri-search-line size-4 text-components-button-secondary-text"
        />
      </IconButton>
    </TipPopup>
  )
}

export default memo(NodeSearchButton)
