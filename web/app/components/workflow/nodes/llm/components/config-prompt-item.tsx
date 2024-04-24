'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { uniqueId } from 'lodash-es'
import { useTranslation } from 'react-i18next'
import type { PromptItem } from '../../../types'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import TypeSelector from '@/app/components/workflow/nodes/_base/components/selector'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
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
  onRemove: () => void
  isShowContext: boolean
  hasSetBlockStatus: {
    context: boolean
    history: boolean
    query: boolean
  }
  availableVars: any
  availableNodes: any
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
  onRemove,
  isShowContext,
  hasSetBlockStatus,
  availableVars,
  availableNodes,
}) => {
  const { t } = useTranslation()
  const [instanceId, setInstanceId] = useState(uniqueId())
  useEffect(() => {
    setInstanceId(`${id}-${uniqueId()}`)
  }, [id])
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

          <TooltipPlus
            popupContent={
              <div className='max-w-[180px]'>{t(`${i18nPrefix}.roleDescription.${payload.role}`)}</div>
            }
          >
            <HelpCircle className='w-3.5 h-3.5 text-gray-400' />
          </TooltipPlus>
        </div>
      }
      value={payload.text}
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
    />
  )
}
export default React.memo(ConfigPromptItem)
