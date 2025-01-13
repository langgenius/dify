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
import Tooltip from '@/app/components/base/tooltip'
import { PromptRole } from '@/models/debug'

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
  useEffect(() => {
    setInstanceId(`${id}-${uniqueId()}`)
  }, [id])

  const handleGenerated = useCallback((prompt: string) => {
    onPromptChange(prompt)
    setTimeout(() => setControlPromptEditorRerenderKey(Date.now()))
  }, [onPromptChange, setControlPromptEditorRerenderKey])

  return (
    <Editor
      className={className}
      headerClassName={headerClassName}
      instanceId={instanceId}
      key={instanceId}
      title={
        <div className='relative left-1 flex items-center'>
          {payload.role === PromptRole.system
            ? (<div className='relative left-[-4px] text-xs font-semibold text-gray-700 uppercase'>
              SYSTEM
            </div>)
            : (
              <TypeSelector
                value={payload.role as string}
                allOptions={roleOptions}
                options={canNotChooseSystemRole ? roleOptionsWithoutSystemRole : roleOptions}
                onChange={handleChatModeMessageRoleChange}
                triggerClassName='text-xs font-semibold text-gray-700 uppercase'
                itemClassName='text-[13px] font-medium text-gray-700'
              />
            )}

          <Tooltip
            popupContent={
              <div className='max-w-[180px]'>{t(`${i18nPrefix}.roleDescription.${payload.role}`)}</div>
            }
            triggerClassName='w-4 h-4'
          />
        </div>
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
  )
}
export default React.memo(ConfigPromptItem)
