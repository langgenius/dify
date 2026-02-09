import type { ToolCallItem } from '@/types/workflow'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { Thinking } from '@/app/components/base/icons/src/vender/workflow'
import BlockIcon from '@/app/components/workflow/block-icon'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'

type ToolCallItemComponentProps = {
  className?: string
  payload: ToolCallItem
}
const ToolCallItemComponent = ({
  className,
  payload,
}: ToolCallItemComponentProps) => {
  const { t } = useTranslation()
  const [expand, setExpand] = useState(false)
  return (
    <div
      className={cn('rounded-[10px] border-[0.5px] border-components-panel-border bg-background-default-subtle px-2 pb-1 pt-2 shadow-xs', className)}
    >
      <div
        className="mb-1 flex cursor-pointer items-center hover:bg-background-gradient-bg-fill-chat-bubble-bg-2"
        onClick={() => {
          setExpand(!expand)
        }}
      >
        {
          payload.type === 'thought' && (
            <Thinking className="mr-1 h-4 w-4 shrink-0" />
          )
        }
        {
          payload.type === 'tool' && (
            <BlockIcon
              type={BlockEnum.Tool}
              toolIcon={payload.toolIcon}
              className="mr-1 h-4 w-4 shrink-0"
            />
          )
        }
        {
          payload.type === 'model' && (
            <AppIcon
              iconType={typeof payload.modelIcon === 'string' ? 'image' : undefined}
              imageUrl={typeof payload.modelIcon === 'string' ? payload.modelIcon : undefined}
              background={typeof payload.modelIcon === 'object' ? payload.modelIcon.background : undefined}
              className="mr-1 h-4 w-4 shrink-0"
            />
          )
        }
        {
          payload.type === 'thought' && (
            <div className="system-xs-medium mr-1 grow truncate text-text-secondary" title={payload.thoughtOutput}>
              {
                payload.thoughtCompleted && !expand && (payload.thoughtOutput || '') as string
              }
              {
                payload.thoughtCompleted && expand && 'THOUGHT'
              }
              {
                !payload.thoughtCompleted && 'THINKING...'
              }
            </div>
          )
        }
        {
          payload.type === 'tool' && (
            <div className="system-xs-medium mr-1 grow truncate text-text-secondary" title={payload.toolName}>{payload.toolName}</div>
          )
        }
        {
          payload.type === 'model' && (
            <div className="system-xs-medium mr-1 grow truncate text-text-secondary" title={payload.modelName}>{payload.modelName}</div>
          )
        }
        {
          !!payload.toolDuration && (
            <div className="system-xs-regular mr-1 shrink-0 text-text-tertiary">
              {payload.toolDuration?.toFixed(1)}
              s
            </div>
          )
        }
        {
          !!payload.modelDuration && (
            <div className="system-xs-regular mr-1 shrink-0 text-text-tertiary">
              {payload.modelDuration?.toFixed(1)}
              s
            </div>
          )
        }
        <RiArrowDownSLine className="h-4 w-4 shrink-0" />
      </div>
      {
        expand && (
          <div className="relative px-2 pl-9">
            <div className="absolute bottom-1 left-2 top-1 w-[1px] bg-divider-regular"></div>
            {
              payload.type === 'thought' && typeof payload.thoughtOutput === 'string' && (
                <div className="body-sm-medium text-text-tertiary">{payload.thoughtOutput}</div>
              )
            }
            {
              payload.type === 'model' && (
                <CodeEditor
                  readOnly
                  title={<div>{t('common.data', { ns: 'workflow' })}</div>}
                  language={CodeLanguage.json}
                  value={payload.modelOutput}
                  isJSONStringifyBeauty
                />
              )
            }
            {
              payload.type === 'tool' && (
                <CodeEditor
                  readOnly
                  title={<div>{t('common.input', { ns: 'workflow' })}</div>}
                  language={CodeLanguage.json}
                  value={payload.toolArguments}
                  isJSONStringifyBeauty
                />
              )
            }
            {
              payload.type === 'tool' && (
                <CodeEditor
                  readOnly
                  className="mt-1"
                  title={<div>{t('common.output', { ns: 'workflow' })}</div>}
                  language={CodeLanguage.json}
                  value={payload.toolOutput}
                  isJSONStringifyBeauty
                />
              )
            }
          </div>
        )
      }
    </div>
  )
}

export default ToolCallItemComponent
