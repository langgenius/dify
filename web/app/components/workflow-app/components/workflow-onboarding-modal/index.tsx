'use client'
import type { FC } from 'react'
import type { PluginDefaultValue } from '@/app/components/workflow/block-selector/types'
import {
  useCallback,
  useEffect,
} from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import { BlockEnum } from '@/app/components/workflow/types'
import StartNodeSelectionPanel from './start-node-selection-panel'

type WorkflowOnboardingModalProps = {
  isShow: boolean
  onClose: () => void
  onSelectStartNode: (nodeType: BlockEnum, toolConfig?: PluginDefaultValue) => void
}

const WorkflowOnboardingModal: FC<WorkflowOnboardingModalProps> = ({
  isShow,
  onClose,
  onSelectStartNode,
}) => {
  const { t } = useTranslation()

  const handleSelectUserInput = useCallback(() => {
    onSelectStartNode(BlockEnum.Start)
    onClose() // Close modal after selection
  }, [onSelectStartNode, onClose])

  const handleTriggerSelect = useCallback((nodeType: BlockEnum, toolConfig?: PluginDefaultValue) => {
    onSelectStartNode(nodeType, toolConfig)
    onClose() // Close modal after selection
  }, [onSelectStartNode, onClose])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isShow)
        onClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [isShow, onClose])

  return (
    <>
      <Modal
        isShow={isShow}
        onClose={onClose}
        className="w-[618px] max-w-[618px] rounded-2xl border border-effects-highlight bg-background-default-subtle shadow-lg"
        overlayOpacity
        closable
        clickOutsideNotClose
      >
        <div className="pb-4">
          {/* Header */}
          <div className="mb-6">
            <h3 className="title-2xl-semi-bold mb-2 text-text-primary">
              {t('onboarding.title', { ns: 'workflow' })}
            </h3>
            <div className="body-xs-regular leading-4 text-text-tertiary">
              {t('onboarding.description', { ns: 'workflow' })}
            </div>
          </div>

          {/* Content */}
          <StartNodeSelectionPanel
            onSelectUserInput={handleSelectUserInput}
            onSelectTrigger={handleTriggerSelect}
          />
        </div>
      </Modal>

      {/* ESC tip below modal */}
      {isShow && (
        <div className="body-xs-regular pointer-events-none fixed left-1/2 top-1/2 z-[70] flex -translate-x-1/2 translate-y-[165px] items-center gap-1 text-text-quaternary">
          <span>{t('onboarding.escTip.press', { ns: 'workflow' })}</span>
          <kbd className="system-kbd inline-flex h-4 min-w-4 items-center justify-center rounded bg-components-kbd-bg-gray px-1 text-text-tertiary">
            {t('onboarding.escTip.key', { ns: 'workflow' })}
          </kbd>
          <span>{t('onboarding.escTip.toDismiss', { ns: 'workflow' })}</span>
        </div>
      )}
    </>
  )
}

export default WorkflowOnboardingModal
