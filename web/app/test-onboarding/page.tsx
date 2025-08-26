'use client'
import { useState } from 'react'
import type { BlockEnum } from '@/app/components/workflow/types'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import WorkflowOnboardingModal from '@/app/components/workflow-app/components/workflow-onboarding-modal'

export default function TestOnboardingPage() {
  const [isShowModal, setIsShowModal] = useState(false)
  const [selectedNode, setSelectedNode] = useState<{
    type: BlockEnum
    config?: ToolDefaultValue
  } | null>(null)

  const handleSelectStartNode = (nodeType: BlockEnum, toolConfig?: ToolDefaultValue) => {
    console.log('Selected node:', nodeType, toolConfig)
    setSelectedNode({ type: nodeType, config: toolConfig })
    setIsShowModal(false) // 正常关闭modal
  }

  const handleCloseModal = () => {
    console.log('Modal closed')
    setIsShowModal(false) // 正常关闭modal
  }

  const handleOpenModal = () => {
    setIsShowModal(true)
    setSelectedNode(null)
  }

  const handleReset = () => {
    setSelectedNode(null)
  }

  return (
    <div className="min-h-screen bg-background-body p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="title-3xl-semi-bold mb-6 text-text-primary">
          Workflow Onboarding Modal Test Page
        </h1>

        <div className="mb-8 space-y-4">
          <div className="flex gap-4">
            <button
              onClick={handleOpenModal}
              className="rounded-lg bg-util-colors-blue-brand-blue-brand-500 px-4 py-2 text-white hover:bg-util-colors-blue-brand-blue-brand-600"
            >
              Open Modal
            </button>

            <button
              onClick={handleReset}
              className="rounded-lg bg-state-destructive-border px-4 py-2 text-text-destructive hover:bg-state-destructive-hover"
            >
              Reset Selection
            </button>
          </div>

          {selectedNode && (
            <div className="rounded-lg border border-components-panel-border bg-background-section-burn p-4">
              <h3 className="system-md-semi-bold mb-2 text-text-primary">Selected Node:</h3>
              <div className="space-y-1">
                <p className="system-sm-regular text-text-secondary">
                  <strong>Type:</strong> {selectedNode.type}
                </p>
                {selectedNode.config && (
                  <p className="system-sm-regular text-text-secondary">
                    <strong>Config:</strong> {JSON.stringify(selectedNode.config, null, 2)}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h2 className="title-xl-semi-bold text-text-primary">Test Instructions:</h2>
          <ul className="system-sm-regular space-y-2 text-text-secondary">
            <li>• Click "Open Modal" to show the onboarding modal</li>
            <li>• Modal can be closed by clicking the X button, pressing ESC, or selecting a node</li>
            <li>• Selected node information will be displayed above</li>
            <li>• Test both "User Input" and "Trigger" selection flows</li>
            <li>• Verify the trigger selection panel shows correctly with back button</li>
            <li>• Check that ESC tips show below the modal</li>
            <li>• Test responsive behavior and styling</li>
          </ul>
        </div>

        <div className="mt-8 rounded-lg border border-components-panel-border bg-background-default-subtle p-4">
          <h3 className="system-md-semi-bold mb-2 text-text-primary">Current State</h3>
          <p className="system-sm-regular text-text-secondary">
            Modal Status: <strong className={isShowModal ? 'text-util-colors-green-green-500' : 'text-text-tertiary'}>
              {isShowModal ? 'Open' : 'Closed'}
            </strong>
          </p>
          {selectedNode && (
            <p className="system-sm-regular text-text-secondary">
              Last Selection: <strong>{selectedNode.type}</strong>
            </p>
          )}
        </div>
      </div>

      {/* The modal */}
      <WorkflowOnboardingModal
        isShow={isShowModal}
        onClose={handleCloseModal}
        onSelectStartNode={handleSelectStartNode}
      />
    </div>
  )
}
