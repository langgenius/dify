'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { uniqueId } from 'lodash-es'
import { useTranslation } from 'react-i18next'
import type { ModelConfig, PromptItem, Variable } from '../../../types'
import { EditionType } from '../../../types'
import { useWorkflowStore } from '../../../store'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import TypeSelector from '@/app/components/workflow/nodes/_base/components/selector'
import { PromptRole } from '@/models/debug'

import PromptTemplateSelectModal from './prompt-template-select-modal'
import type { PromptTemplate } from '@/models/prompt-template'

const i18nPrefix = 'workflow.nodes.llm'

type Props = {
  className?: string
  headerClassName?: string
  canNotChooseSystemRole?: boolean
  readOnly: boolean
  id: string
  canRemove: boolean
  isChatModel: boolean
  isChatApp: boolean
  payload: PromptItem
  handleChatModeMessageRoleChange: (role: PromptRole) => void
  onPromptChange: (p: string) => void
  onEditionTypeChange: (editionType: EditionType) => void
  onRemove: () => void
  isShowContext: boolean
  hasSetBlockStatus: {
    context: boolean
    history: boolean
    query: boolean
  }
  availableVars: any
  availableNodes: any
  varList: Variable[]
  handleAddVariable: (payload: any) => void
  modelConfig?: ModelConfig
}

const roleOptions = [
  {
    label: 'system',
    value: PromptRole.system,
  },
  {
    label: 'user',
    value: PromptRole.user,
  },
  {
    label: 'assistant',
    value: PromptRole.assistant,
  },
]

const roleOptionsWithoutSystemRole = roleOptions.filter(item => item.value !== PromptRole.system)

const ConfigPromptItem: FC<Props> = ({
  className,
  headerClassName,
  canNotChooseSystemRole,
  readOnly,
  id,
  canRemove,
  handleChatModeMessageRoleChange,
  isChatModel,
  isChatApp,
  payload,
  onPromptChange,
  onEditionTypeChange,
  onRemove,
  isShowContext,
  hasSetBlockStatus,
  availableVars,
  availableNodes,
  varList,
  handleAddVariable,
  modelConfig,
}) => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const {
    setControlPromptEditorRerenderKey,
  } = workflowStore.getState()
  const [instanceId, setInstanceId] = useState(uniqueId())
  const [showPromptTemplateModal, setShowPromptTemplateModal] = useState(false)

  useEffect(() => {
    setInstanceId(`${id}-${uniqueId()}`)
  }, [id])

  const handleGenerated = useCallback((prompt: string) => {
    onPromptChange(prompt)
    setTimeout(() => setControlPromptEditorRerenderKey(Date.now()))
  }, [onPromptChange, setControlPromptEditorRerenderKey])

  const handleSelectTemplate = (template: PromptTemplate) => {
    onPromptChange(template.prompt_content || '')
    setShowPromptTemplateModal(false)
    setTimeout(() => setControlPromptEditorRerenderKey(Date.now()))
  }

  return (
    <>
      <Editor
        className={className}
        headerClassName={headerClassName}
        instanceId={instanceId}
        key={instanceId}
        title={
          payload.role === PromptRole.system
            ? 'SYSTEM TEST'
            : <TypeSelector
              value={payload.role as string}
              allOptions={roleOptions}
              options={canNotChooseSystemRole ? roleOptionsWithoutSystemRole : roleOptions}
              onChange={handleChatModeMessageRoleChange}
              triggerClassName='text-xs font-semibold text-text-secondary uppercase'
              itemClassName='text-[13px] font-medium text-text-secondary'
            />
        }
        rightTools={
          (payload.role === PromptRole.system || payload.role === PromptRole.user)
            ? (
              <div
                className='mr-1 flex h-6 cursor-pointer items-center justify-center rounded-md bg-gray-100 px-2 text-xs font-semibold text-gray-700 hover:bg-gray-200'
                onClick={() => setShowPromptTemplateModal(true)}
              >
                {t('common.promptTemplate.import')}
              </div>
            )
            : undefined
        }
        value={payload.edition_type === EditionType.jinja2 ? (payload.jinja2_text || '') : payload.text}
        onChange={onPromptChange}
        readOnly={readOnly}
        showRemove={canRemove}
        onRemove={onRemove}
        isChatModel={isChatModel}
        isChatApp={isChatApp}
        isShowContext={isShowContext}
        hasSetBlockStatus={hasSetBlockStatus}
        nodesOutputVars={availableVars}
        availableNodes={availableNodes}
        isSupportPromptGenerator={payload.role === PromptRole.system}
        onGenerated={handleGenerated}
        modelConfig={modelConfig}
        isSupportJinja
        editionType={payload.edition_type}
        onEditionTypeChange={onEditionTypeChange}
        varList={varList}
        handleAddVariable={handleAddVariable}
        isSupportFileVar
      />
      {showPromptTemplateModal && (
        <PromptTemplateSelectModal
          isShow
          onClose={() => setShowPromptTemplateModal(false)}
          onSelect={handleSelectTemplate}
        />
      )}
    </>
  )
}
export default React.memo(ConfigPromptItem)
