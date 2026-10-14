import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import AppIcon from '@/app/components/base/app-icon'
import { API_PREFIX } from '@/config'
import { BlockEnum } from './types'

type BlockIconSize = 'xs' | 'sm' | 'md'

type BlockIconProps = {
  type: BlockEnum
  size?: BlockIconSize
  className?: string
  iconClassName?: string
  toolIcon?: string | { content: string; background: string }
}
const ICON_CONTAINER_CLASSNAME_SIZE_MAP: Record<BlockIconSize, string> = {
  xs: 'w-4 h-4 rounded-[5px] shadow-xs',
  sm: 'w-5 h-5 rounded-md shadow-xs',
  md: 'w-6 h-6 rounded-lg shadow-md',
}
const ICON_CLASSNAME_SIZE_MAP: Record<BlockIconSize, string> = {
  xs: 'size-3',
  sm: 'size-3.5',
  md: 'size-4',
}

const DEFAULT_ICON_CLASS_MAP: Record<BlockEnum, string | null> = {
  [BlockEnum.Start]: 'i-custom-vender-workflow-home',
  [BlockEnum.StartPlaceholder]: 'i-custom-vender-workflow-home',
  [BlockEnum.LLM]: 'i-custom-vender-workflow-llm',
  [BlockEnum.Code]: 'i-custom-vender-workflow-code',
  [BlockEnum.End]: 'i-custom-vender-workflow-end',
  [BlockEnum.IfElse]: 'i-custom-vender-workflow-if-else',
  [BlockEnum.HttpRequest]: 'i-custom-vender-workflow-http',
  [BlockEnum.Answer]: 'i-custom-vender-workflow-answer',
  [BlockEnum.KnowledgeRetrieval]: 'i-custom-vender-workflow-knowledge-retrieval',
  [BlockEnum.QuestionClassifier]: 'i-custom-vender-workflow-question-classifier',
  [BlockEnum.TemplateTransform]: 'i-custom-vender-workflow-templating-transform',
  [BlockEnum.VariableAssigner]: 'i-custom-vender-workflow-variable-x',
  [BlockEnum.VariableAggregator]: 'i-custom-vender-workflow-variable-x',
  [BlockEnum.Assigner]: 'i-custom-vender-workflow-assigner',
  [BlockEnum.Tool]: 'i-custom-vender-workflow-variable-x',
  [BlockEnum.IterationStart]: 'i-custom-vender-workflow-variable-x',
  [BlockEnum.Iteration]: 'i-custom-vender-workflow-iteration',
  [BlockEnum.LoopStart]: 'i-custom-vender-workflow-variable-x',
  [BlockEnum.Loop]: 'i-custom-vender-workflow-loop',
  [BlockEnum.LoopEnd]: 'i-custom-vender-workflow-loop-end',
  [BlockEnum.ParameterExtractor]: 'i-custom-vender-workflow-parameter-extractor',
  [BlockEnum.DocExtractor]: 'i-custom-vender-workflow-docs-extractor',
  [BlockEnum.ListFilter]: 'i-custom-vender-workflow-list-filter',
  [BlockEnum.Agent]: 'i-custom-vender-workflow-agent',
  [BlockEnum.AgentV2]: 'i-custom-vender-workflow-agent',
  [BlockEnum.KnowledgeBase]: 'i-custom-vender-workflow-knowledge-base',
  [BlockEnum.DataSource]: 'i-custom-vender-workflow-datasource',
  [BlockEnum.DataSourceEmpty]: null,
  [BlockEnum.TriggerSchedule]: 'i-custom-vender-workflow-schedule',
  [BlockEnum.TriggerWebhook]: 'i-custom-vender-workflow-webhook-line',
  [BlockEnum.TriggerPlugin]: 'i-custom-vender-workflow-variable-x',
  [BlockEnum.HumanInput]: 'i-custom-vender-workflow-human-in-loop',
}

const getIcon = (type: BlockEnum, className: string) => {
  const iconClassName = DEFAULT_ICON_CLASS_MAP[type]
  if (!iconClassName) return null

  return <span aria-hidden className={cn(iconClassName, className)} />
}

const normalizeToolIconUrl = (toolIcon: string) => {
  const protectedPluginIconPath = '/workspaces/current/plugin/icon'
  const pathIndex = toolIcon.indexOf(protectedPluginIconPath)

  if (pathIndex < 0) return toolIcon

  return `${API_PREFIX}${toolIcon.slice(pathIndex)}`
}

const ICON_CONTAINER_BG_COLOR_MAP: Record<string, string> = {
  [BlockEnum.Start]: 'bg-util-colors-blue-brand-blue-brand-500',
  [BlockEnum.StartPlaceholder]: 'bg-util-colors-blue-brand-blue-brand-500',
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
  [BlockEnum.AgentV2]: 'bg-util-colors-indigo-indigo-500',
  [BlockEnum.HumanInput]: 'bg-util-colors-cyan-cyan-500',
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
  iconClassName,
  toolIcon,
}) => {
  const isStart = type === BlockEnum.Start
  const isStartPlaceholder = type === BlockEnum.StartPlaceholder
  const isToolOrDataSourceOrTriggerPlugin =
    type === BlockEnum.Tool || type === BlockEnum.DataSource || type === BlockEnum.TriggerPlugin
  const showDefaultIcon = !isToolOrDataSourceOrTriggerPlugin || !toolIcon
  const resolvedToolIcon = typeof toolIcon === 'string' ? normalizeToolIconUrl(toolIcon) : toolIcon

  if (isStart) {
    return (
      <div
        className={cn(
          'flex items-center justify-center border-[0.5px] border-white/2 bg-util-colors-blue-brand-blue-brand-500 text-white',
          ICON_CONTAINER_CLASSNAME_SIZE_MAP[size],
          className,
        )}
      >
        <span
          aria-hidden
          className={cn(
            'i-custom-vender-workflow-user-input',
            ICON_CLASSNAME_SIZE_MAP[size],
            iconClassName,
          )}
        />
      </div>
    )
  }

  if (isStartPlaceholder) {
    return (
      <div
        className={cn(
          'flex items-center justify-center border border-dashed border-components-panel-border bg-state-base-hover text-text-tertiary shadow-none',
          ICON_CONTAINER_CLASSNAME_SIZE_MAP[size],
          className,
        )}
      >
        <span
          aria-hidden
          className={cn(
            'i-custom-vender-workflow-start-placeholder text-text-primary opacity-30',
            ICON_CLASSNAME_SIZE_MAP[size],
            iconClassName,
          )}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center border-[0.5px] border-white/2 text-white',
        ICON_CONTAINER_CLASSNAME_SIZE_MAP[size],
        showDefaultIcon && ICON_CONTAINER_BG_COLOR_MAP[type],
        toolIcon && 'shadow-none!',
        className,
      )}
    >
      {showDefaultIcon && getIcon(type, cn(ICON_CLASSNAME_SIZE_MAP[size], iconClassName))}
      {!showDefaultIcon && (
        <>
          {typeof resolvedToolIcon === 'string' ? (
            <div
              className="size-full shrink-0 rounded-md bg-cover bg-center"
              style={{
                backgroundImage: `url(${resolvedToolIcon})`,
              }}
            ></div>
          ) : (
            <AppIcon
              className="size-full! shrink-0"
              size="tiny"
              icon={resolvedToolIcon?.content}
              background={resolvedToolIcon?.background}
            />
          )}
        </>
      )}
    </div>
  )
}

export const VarBlockIcon: FC<BlockIconProps> = ({ type, className }) => {
  return <>{getIcon(type, `w-3 h-3 ${className}`)}</>
}

export default memo(BlockIcon)
