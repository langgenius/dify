import type { FC } from 'react'
import { memo } from 'react'
import AppIcon from '@/app/components/base/app-icon'
import {
  Agent,
  Answer,
  Assigner,
  Code,
  Datasource,
  DocsExtractor,
  End,
  Home,
  Http,
  IfElse,
  Iteration,
  KnowledgeBase,
  KnowledgeRetrieval,
  ListFilter,
  Llm,
  Loop,
  LoopEnd,
  ParameterExtractor,
  QuestionClassifier,
  Schedule,
  TemplatingTransform,
  VariableX,
  WebhookLine,
} from '@/app/components/base/icons/src/vender/workflow'
import { cn } from '@/utils/classnames'
import { BlockEnum } from './types'

type BlockIconProps = {
  type: BlockEnum
  size?: string
  className?: string
  toolIcon?: string | { content: string, background: string }
}
const ICON_CONTAINER_CLASSNAME_SIZE_MAP: Record<string, string> = {
  xs: 'w-4 h-4 rounded-[5px] shadow-xs',
  sm: 'w-5 h-5 rounded-md shadow-xs',
  md: 'w-6 h-6 rounded-lg shadow-md',
}

const DEFAULT_ICON_MAP: Record<BlockEnum, React.ComponentType<{ className: string }>> = {
  [BlockEnum.Start]: Home,
  [BlockEnum.LLM]: Llm,
  [BlockEnum.Code]: Code,
  [BlockEnum.End]: End,
  [BlockEnum.IfElse]: IfElse,
  [BlockEnum.HttpRequest]: Http,
  [BlockEnum.Answer]: Answer,
  [BlockEnum.KnowledgeRetrieval]: KnowledgeRetrieval,
  [BlockEnum.QuestionClassifier]: QuestionClassifier,
  [BlockEnum.TemplateTransform]: TemplatingTransform,
  [BlockEnum.VariableAssigner]: VariableX,
  [BlockEnum.VariableAggregator]: VariableX,
  [BlockEnum.Assigner]: Assigner,
  [BlockEnum.Tool]: VariableX,
  [BlockEnum.IterationStart]: VariableX,
  [BlockEnum.Iteration]: Iteration,
  [BlockEnum.LoopStart]: VariableX,
  [BlockEnum.Loop]: Loop,
  [BlockEnum.LoopEnd]: LoopEnd,
  [BlockEnum.ParameterExtractor]: ParameterExtractor,
  [BlockEnum.DocExtractor]: DocsExtractor,
  [BlockEnum.ListFilter]: ListFilter,
  [BlockEnum.Agent]: Agent,
  [BlockEnum.KnowledgeBase]: KnowledgeBase,
  [BlockEnum.DataSource]: Datasource,
  [BlockEnum.DataSourceEmpty]: () => null,
  [BlockEnum.TriggerSchedule]: Schedule,
  [BlockEnum.TriggerWebhook]: WebhookLine,
  [BlockEnum.TriggerPlugin]: VariableX,
}

const getIcon = (type: BlockEnum, className: string) => {
  const DefaultIcon = DEFAULT_ICON_MAP[type]
  if (!DefaultIcon)
    return null

  return <DefaultIcon className={className} />
}
const ICON_CONTAINER_BG_COLOR_MAP: Record<string, string> = {
  [BlockEnum.Start]: 'bg-util-colors-blue-brand-blue-brand-500',
  [BlockEnum.LLM]: 'bg-util-colors-indigo-indigo-500',
  [BlockEnum.Code]: 'bg-util-colors-blue-blue-500',
  [BlockEnum.End]: 'bg-util-colors-warning-warning-500',
  [BlockEnum.IfElse]: 'bg-util-colors-cyan-cyan-500',
  [BlockEnum.Iteration]: 'bg-util-colors-cyan-cyan-500',
  [BlockEnum.Loop]: 'bg-util-colors-cyan-cyan-500',
  [BlockEnum.LoopEnd]: 'bg-util-colors-warning-warning-500',
  [BlockEnum.HttpRequest]: 'bg-util-colors-violet-violet-500',
  [BlockEnum.Answer]: 'bg-util-colors-warning-warning-500',
  [BlockEnum.KnowledgeRetrieval]: 'bg-util-colors-green-green-500',
  [BlockEnum.QuestionClassifier]: 'bg-util-colors-green-green-500',
  [BlockEnum.TemplateTransform]: 'bg-util-colors-blue-blue-500',
  [BlockEnum.VariableAssigner]: 'bg-util-colors-blue-blue-500',
  [BlockEnum.VariableAggregator]: 'bg-util-colors-blue-blue-500',
  [BlockEnum.Tool]: 'bg-util-colors-blue-blue-500',
  [BlockEnum.Assigner]: 'bg-util-colors-blue-blue-500',
  [BlockEnum.ParameterExtractor]: 'bg-util-colors-blue-blue-500',
  [BlockEnum.DocExtractor]: 'bg-util-colors-green-green-500',
  [BlockEnum.ListFilter]: 'bg-util-colors-cyan-cyan-500',
  [BlockEnum.Agent]: 'bg-util-colors-indigo-indigo-500',
  [BlockEnum.KnowledgeBase]: 'bg-util-colors-warning-warning-500',
  [BlockEnum.DataSource]: 'bg-components-icon-bg-midnight-solid',
  [BlockEnum.TriggerSchedule]: 'bg-util-colors-violet-violet-500',
  [BlockEnum.TriggerWebhook]: 'bg-util-colors-blue-blue-500',
  [BlockEnum.TriggerPlugin]: 'bg-util-colors-blue-blue-500',
}
const BlockIcon: FC<BlockIconProps> = ({
  type,
  size = 'sm',
  className,
  toolIcon,
}) => {
  const isToolOrDataSourceOrTriggerPlugin = type === BlockEnum.Tool || type === BlockEnum.DataSource || type === BlockEnum.TriggerPlugin
  const showDefaultIcon = !isToolOrDataSourceOrTriggerPlugin || !toolIcon

  return (
    <div className={
      cn(
        'flex items-center justify-center border-[0.5px] border-white/2 text-white',
        ICON_CONTAINER_CLASSNAME_SIZE_MAP[size],
        showDefaultIcon && ICON_CONTAINER_BG_COLOR_MAP[type],
        toolIcon && '!shadow-none',
        className,
      )
    }
    >
      {
        showDefaultIcon && (
          getIcon(type, (type === BlockEnum.TriggerSchedule || type === BlockEnum.TriggerWebhook)
            ? (size === 'xs' ? 'w-4 h-4' : 'w-4.5 h-4.5')
            : (size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5'))
        )
      }
      {
        !showDefaultIcon && (
          <>
            {
              typeof toolIcon === 'string'
                ? (
                    <div
                      className="h-full w-full shrink-0 rounded-md bg-cover bg-center"
                      style={{
                        backgroundImage: `url(${toolIcon})`,
                      }}
                    >
                    </div>
                  )
                : (
                    <AppIcon
                      className="!h-full !w-full shrink-0"
                      size="tiny"
                      icon={toolIcon?.content}
                      background={toolIcon?.background}
                    />
                  )
            }
          </>
        )
      }
    </div>
  )
}

export const VarBlockIcon: FC<BlockIconProps> = ({
  type,
  className,
}) => {
  return (
    <>
      {getIcon(type, `w-3 h-3 ${className}`)}
    </>
  )
}

export default memo(BlockIcon)
