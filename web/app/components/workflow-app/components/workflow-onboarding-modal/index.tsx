'use client'
import type { FC } from 'react'
import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import { RiCloseLine } from '@remixicon/react'
import { BlockEnum } from '@/app/components/workflow/types'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import Modal from '@/app/components/base/modal'
import StartNodeSelectionPanel from './start-node-selection-panel'
import TriggerSelectionPanel from './trigger-selection-panel'

type WorkflowOnboardingModalProps = {
  isShow: boolean
  onClose: () => void
  onSelectStartNode: (nodeType: BlockEnum, toolConfig?: ToolDefaultValue) => void
}

const WorkflowOnboardingModal: FC<WorkflowOnboardingModalProps> = ({
  isShow,
  onClose,
  onSelectStartNode,
}) => {
  const [showTriggerPanel, setShowTriggerPanel] = useState(false)

  const handleSelectUserInput = useCallback(() => {
    onSelectStartNode(BlockEnum.Start)
  }, [onSelectStartNode])

  const handleSelectTrigger = useCallback(() => {
    setShowTriggerPanel(true)
  }, [])

  const handleTriggerSelect = useCallback((nodeType: BlockEnum, toolConfig?: ToolDefaultValue) => {
    onSelectStartNode(nodeType, toolConfig)
  }, [onSelectStartNode])

  const handleBack = useCallback(() => {
    setShowTriggerPanel(false)
  }, [])

  const handleClose = useCallback(() => {
    setShowTriggerPanel(false)
    onClose()
  }, [onClose])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isShow)
        handleClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [isShow, handleClose])

  return (
    <Modal
      isShow={isShow}
      onClose={handleClose}
      closable={false}
      className="w-auto max-w-none"
      highPriority={true}
    >
      <div className="relative">
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
        >
          <RiCloseLine className="h-4 w-4" />
        </button>

        {!showTriggerPanel ? (
          <StartNodeSelectionPanel
            onSelectUserInput={handleSelectUserInput}
            onSelectTrigger={handleSelectTrigger}
          />
        ) : (
          <TriggerSelectionPanel
            onSelect={handleTriggerSelect}
            onBack={handleBack}
          />
        )}
      </div>

      <div className="absolute -bottom-8 left-1/2 -translate-x-1/2">
        <span className="text-sm text-text-tertiary">
          Press <kbd className="inline-flex items-center rounded border border-components-panel-border bg-background-section-burn px-1.5 py-0.5 font-mono text-xs">esc</kbd> to dismiss
        </span>
      </div>
    </Modal>
  )
}

export default WorkflowOnboardingModal
