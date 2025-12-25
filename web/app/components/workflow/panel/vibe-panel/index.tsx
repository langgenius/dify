'use client'

import type { FC } from 'react'
import { RiCheckLine, RiCloseLine, RiLoader2Line, RiRefreshLine } from '@remixicon/react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Flowchart from '@/app/components/base/mermaid'
import { cn } from '@/utils/classnames'
import { VIBE_ACCEPT_EVENT, VIBE_REGENERATE_EVENT } from '../../constants'
import { useStore } from '../../store'

const VibePanel: FC = () => {
  const { t } = useTranslation()
  const showVibePanel = useStore(s => s.showVibePanel)
  const setShowVibePanel = useStore(s => s.setShowVibePanel)
  const vibePanelMermaidCode = useStore(s => s.vibePanelMermaidCode)
  const setVibePanelMermaidCode = useStore(s => s.setVibePanelMermaidCode)
  const isVibeGenerating = useStore(s => s.isVibeGenerating)
  const setIsVibeGenerating = useStore(s => s.setIsVibeGenerating)

  const handleClose = useCallback(() => {
    setShowVibePanel(false)
    setVibePanelMermaidCode('')
    setIsVibeGenerating(false)
  }, [setShowVibePanel, setVibePanelMermaidCode, setIsVibeGenerating])

  const handleAccept = useCallback(() => {
    if (vibePanelMermaidCode) {
      const event = new CustomEvent(VIBE_ACCEPT_EVENT, {
        detail: { dsl: vibePanelMermaidCode },
      })
      document.dispatchEvent(event)
      handleClose()
    }
  }, [vibePanelMermaidCode, handleClose])

  const handleRegenerate = useCallback(() => {
    setIsVibeGenerating(true)
    const event = new CustomEvent(VIBE_REGENERATE_EVENT)
    document.dispatchEvent(event)
  }, [setIsVibeGenerating])

  if (!showVibePanel)
    return null

  return (
    <div
      className={cn(
        'absolute bottom-0 right-0 top-0 z-20',
        'flex flex-col',
        'w-[600px] border-l border-divider-subtle',
        'bg-components-panel-bg backdrop-blur-[10px]',
        'rounded-xl shadow-xl',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-divider-subtle px-4 py-3">
        <div className="text-sm font-semibold text-text-primary">
          {t('workflow.vibe.panelTitle')}
        </div>
        <button
          onClick={handleClose}
          className="rounded-lg p-1 transition-colors hover:bg-state-base-hover"
        >
          <RiCloseLine className="h-4 w-4 text-text-tertiary" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {isVibeGenerating && !vibePanelMermaidCode
          ? (
              <div className="flex h-full flex-col items-center justify-center gap-4">
                <RiLoader2Line className="h-4 w-4 animate-spin text-text-tertiary" />
                <div className="text-sm text-text-tertiary">
                  {t('workflow.vibe.generatingFlowchart')}
                </div>
              </div>
            )
          : vibePanelMermaidCode
            ? (
                <div className="h-full">
                  <Flowchart
                    PrimitiveCode={vibePanelMermaidCode}
                    theme="light"
                  />
                </div>
              )
            : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-text-tertiary">
                  <div>{t('workflow.vibe.noFlowchartYet')}</div>
                </div>
              )}
      </div>

      {/* Footer Actions */}
      {vibePanelMermaidCode && !isVibeGenerating && (
        <div className="flex items-center justify-end gap-2 border-t border-divider-subtle px-4 py-3">
          <Button
            variant="secondary"
            size="medium"
            onClick={handleRegenerate}
          >
            <RiRefreshLine className="mr-1 h-4 w-4" />
            {t('workflow.vibe.regenerate')}
          </Button>
          <Button
            variant="primary"
            size="medium"
            onClick={handleAccept}
          >
            <RiCheckLine className="mr-1 h-4 w-4" />
            {t('workflow.vibe.accept')}
          </Button>
        </div>
      )}
    </div>
  )
}

export default VibePanel
