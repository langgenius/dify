'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import MemoryConfig from '../../_base/components/memory-config'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import type { Memory, Node, NodeOutPutVar } from '@/app/components/workflow/types'
import Tooltip from '@/app/components/base/tooltip'
const i18nPrefix = 'workflow.nodes.questionClassifiers'

type Props = {
  instruction: string
  onInstructionChange: (instruction: string) => void
  hideMemorySetting: boolean
  memory?: Memory
  onMemoryChange: (memory?: Memory) => void
  readonly?: boolean
  isChatModel: boolean
  isChatApp: boolean
  hasSetBlockStatus?: {
    context: boolean
    history: boolean
    query: boolean
  }
  nodesOutputVars: NodeOutPutVar[]
  availableNodes: Node[]
  // Custom prompt props
  systemPrompt?: string
  onSystemPromptChange?: (systemPrompt: string) => void
  completionPrompt?: string
  onCompletionPromptChange?: (completionPrompt: string) => void
}

const AdvancedSetting: FC<Props> = ({
  instruction,
  onInstructionChange,
  hideMemorySetting,
  memory,
  onMemoryChange,
  readonly,
  isChatModel,
  isChatApp,
  hasSetBlockStatus,
  nodesOutputVars,
  availableNodes,
  systemPrompt,
  onSystemPromptChange,
  completionPrompt,
  onCompletionPromptChange,
}) => {
  const { t } = useTranslation()

  return (
    <>
      <Editor
        title={
          <div className='flex items-center space-x-1'>
            <span className='uppercase'>{t(`${i18nPrefix}.instruction`)}</span>
            <Tooltip
              popupContent={
                <div className='w-[120px]'>
                  {t(`${i18nPrefix}.instructionTip`)}
                </div>
              }
              triggerClassName='w-3.5 h-3.5 ml-0.5'
            />
          </div>
        }
        value={instruction}
        onChange={onInstructionChange}
        readOnly={readonly}
        isChatModel={isChatModel}
        isChatApp={isChatApp}
        isShowContext={false}
        hasSetBlockStatus={hasSetBlockStatus}
        nodesOutputVars={nodesOutputVars}
        availableNodes={availableNodes}
      />

      {/* Custom Prompts Section */}
      <div className='mt-4'>
        <div className='mb-2 text-sm font-medium uppercase text-text-tertiary'>
          {t(`${i18nPrefix}.customPrompts`)}
        </div>

        <div className='space-y-3'>
          {isChatModel && onSystemPromptChange && (
            <Editor
              title={t(`${i18nPrefix}.customSystemPrompt`)}
              value={systemPrompt ?? ''}
              onChange={onSystemPromptChange}
              readOnly={readonly}
              isChatModel={isChatModel}
              isChatApp={isChatApp}
              isShowContext={false}
              hasSetBlockStatus={hasSetBlockStatus}
              nodesOutputVars={nodesOutputVars}
              availableNodes={availableNodes}
              placeholder={t(`${i18nPrefix}.systemPromptPlaceholder`)}
            />
          )}

          {!isChatModel && onCompletionPromptChange && (
            <Editor
              title={t(`${i18nPrefix}.customCompletionPrompt`)}
              value={completionPrompt ?? ''}
              onChange={onCompletionPromptChange}
              readOnly={readonly}
              isChatModel={isChatModel}
              isChatApp={isChatApp}
              isShowContext={false}
              hasSetBlockStatus={hasSetBlockStatus}
              nodesOutputVars={nodesOutputVars}
              availableNodes={availableNodes}
              placeholder={t(`${i18nPrefix}.completionPromptPlaceholder`)}
            />
          )}
        </div>
      </div>

      {!hideMemorySetting && (
        <MemoryConfig
          className='mt-4'
          readonly={false}
          config={{ data: memory }}
          onChange={onMemoryChange}
          canSetRoleName={false}
        />
      )}
    </>
  )
}
export default React.memo(AdvancedSetting)
