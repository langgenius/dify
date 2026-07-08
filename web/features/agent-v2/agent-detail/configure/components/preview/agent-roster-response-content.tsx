import type { ReactNode } from 'react'
import type { ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { ChatItem } from '@/app/components/base/chat/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileList } from '@/app/components/base/file-uploader'
import { Markdown } from '@/app/components/base/markdown'

type AgentRosterResponseContentProps = {
  item: ChatItem
  responding?: boolean
  content?: string
}

type ToolProcess = {
  name: string
  label: string
  input: string
  output: string
  isFinished: boolean
}

function readIndexedValue(value: string, isArray: boolean, index: number) {
  if (!isArray)
    return value

  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? String(parsed[index] ?? '') : value
  }
  catch {
    return value
  }
}

function getToolProcesses(thought: ThoughtItem, responding?: boolean): ToolProcess[] {
  let toolNames = [thought.tool]
  let isArray = false

  try {
    const parsed = JSON.parse(thought.tool) as unknown
    if (Array.isArray(parsed)) {
      toolNames = parsed.map(item => String(item))
      isArray = true
    }
  }
  catch {
  }

  return toolNames
    .filter(Boolean)
    .map((name, index) => ({
      name,
      label: thought.tool_labels?.toolName?.en_US ?? name,
      input: readIndexedValue(thought.tool_input, isArray, index),
      output: readIndexedValue(thought.observation, isArray, index),
      isFinished: !!thought.observation || !responding,
    }))
}

function formatLatencyDuration(latency: NonNullable<ChatItem['more']>['latency']) {
  const numericLatency = Number(latency)
  if (!Number.isNaN(numericLatency))
    return `${Number(numericLatency.toFixed(2))}s`

  return `${latency}s`
}

function useWorkingDuration(enabled?: boolean) {
  const startedAt = useMemo(() => Date.now(), [enabled])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled)
      return

    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [enabled])

  const elapsedSeconds = enabled
    ? Math.max(0, Math.floor((now - startedAt) / 1000))
    : 0

  return `${elapsedSeconds}s`
}

function ProcessShell({
  children,
  collapsed,
  icon,
  title,
  defaultOpen = false,
}: {
  children?: ReactNode
  collapsed?: boolean
  icon: ReactNode
  title: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const canExpand = !!children
  const expanded = canExpand && open && !collapsed

  return (
    <div className={cn(
      'rounded-xl p-2',
      expanded ? 'bg-background-default' : 'bg-background-default-subtle',
    )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-1 text-left"
        onClick={() => canExpand && setOpen(value => !value)}
      >
        <span className="flex size-5 shrink-0 items-center justify-center text-text-secondary">
          {icon}
        </span>
        <span className={cn(
          'min-w-0 flex-1 truncate text-text-secondary',
          expanded ? 'system-xs-medium-uppercase' : 'system-sm-regular',
        )}
        >
          {title}
        </span>
        {canExpand && (
          expanded
            ? <span className="i-ri-arrow-down-s-line size-4 shrink-0 text-text-quaternary" aria-hidden />
            : <span className="i-ri-arrow-right-s-line size-4 shrink-0 text-text-quaternary" aria-hidden />
        )}
      </button>
      {expanded && (
        <div className="mt-1 flex gap-1">
          <div className="w-5 shrink-0 border-l border-divider-subtle" />
          <div className="min-w-0 flex-1 py-1 body-sm-regular text-text-tertiary">
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

function ThoughtProcess({
  thought,
  defaultOpen,
}: {
  thought: ThoughtItem
  defaultOpen?: boolean
}) {
  const { t } = useTranslation()
  const summary = thought.thought.trim() || t('chat.thought', { ns: 'common' })

  return (
    <ProcessShell
      icon={<span className="i-ri-sparkling-2-line size-3.5" aria-hidden />}
      title={defaultOpen ? t('chat.thought', { ns: 'common' }) : summary}
      defaultOpen={defaultOpen}
    >
      <Markdown content={summary} />
    </ProcessShell>
  )
}

function ToolProcessCard({
  tool,
}: {
  tool: ToolProcess
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-xl bg-background-default-subtle p-2">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-left"
        onClick={() => setOpen(value => !value)}
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-divider-subtle bg-components-icon-bg-midnight-solid p-[3px] text-text-primary-on-surface shadow-xs">
          {tool.isFinished
            ? <span className="i-ri-terminal-box-line size-3.5" aria-hidden />
            : <span className="i-ri-loader-2-line size-3.5 animate-spin" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1 truncate system-sm-medium text-text-secondary">{tool.label}</span>
        {open
          ? <span className="i-ri-arrow-down-s-line size-4 shrink-0 text-text-quaternary" aria-hidden />
          : <span className="i-ri-arrow-right-s-line size-4 shrink-0 text-text-quaternary" aria-hidden />}
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          <div className="rounded-[10px] bg-components-panel-on-panel-item-bg px-3 py-2">
            <div className="system-xs-semibold-uppercase text-text-tertiary">
              {t('thought.requestTitle', { ns: 'tools' })}
            </div>
            <div className="mt-1 code-xs-regular wrap-break-word text-text-secondary">{tool.input}</div>
          </div>
          <div className="rounded-[10px] bg-components-panel-on-panel-item-bg px-3 py-2">
            <div className="system-xs-semibold-uppercase text-text-tertiary">
              {t('thought.responseTitle', { ns: 'tools' })}
            </div>
            <div className="mt-1 code-xs-regular wrap-break-word text-text-secondary">{tool.output}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function AgentThoughtsProcessList({
  item,
  responding,
}: {
  item: ChatItem
  responding?: boolean
}) {
  return (
    <div className="mt-2 flex flex-col gap-1">
      {item.agent_thoughts?.map((thought, index) => {
        const tools = getToolProcesses(thought, responding)
        return (
          <div key={thought.id || `${thought.message_id}-${thought.position}`} className="flex flex-col gap-1">
            {thought.thought && (
              <ThoughtProcess
                thought={thought}
                defaultOpen={index === 0}
              />
            )}
            {tools.map(tool => (
              <ToolProcessCard
                key={`${thought.id}-${tool.name}`}
                tool={tool}
              />
            ))}
            {!!thought.message_files?.length && (
              <FileList
                className="px-2 py-1"
                files={thought.message_files}
                showDeleteAction={false}
                showDownloadAction
                canPreview
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function AgentThoughtsProcessGroup({
  item,
  responding,
}: {
  item: ChatItem
  responding?: boolean
}) {
  const { t } = useTranslation('agentV2')
  const [open, setOpen] = useState(false)
  const workingDuration = useWorkingDuration(responding)
  const workedDuration = item.more?.latency == null ? '0s' : formatLatencyDuration(item.more.latency)

  if (responding) {
    return (
      <div className="flex flex-col">
        <div className="flex h-9 w-full items-center border-b border-divider-subtle text-left">
          <span className="system-md-regular text-text-tertiary">
            {t('agentDetail.configure.answer.workingFor', { duration: workingDuration })}
          </span>
        </div>
        <AgentThoughtsProcessList
          item={item}
          responding={responding}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        className="flex h-9 w-full items-center gap-1 border-b border-divider-subtle text-left"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span className="system-md-regular text-text-tertiary">
          {t('agentDetail.configure.answer.workedFor', { duration: workedDuration })}
        </span>
        {open
          ? <span className="i-ri-arrow-down-s-line size-4 text-text-tertiary" aria-hidden />
          : <span className="i-ri-arrow-right-s-line size-4 text-text-tertiary" aria-hidden />}
      </button>
      {open && (
        <AgentThoughtsProcessList
          item={item}
          responding={responding}
        />
      )}
    </div>
  )
}

export function AgentRosterResponseContent({
  item,
  responding,
  content,
}: AgentRosterResponseContentProps) {
  const {
    annotation,
    agent_thoughts,
  } = item

  if (annotation?.logAnnotation) {
    return (
      <Markdown
        content={annotation.logAnnotation.content || ''}
        data-testid="agent-content-markdown"
      />
    )
  }

  return (
    <div className="flex w-full flex-col gap-1" data-testid="agent-roster-response-content">
      {!!agent_thoughts?.length && (
        <AgentThoughtsProcessGroup
          item={item}
          responding={responding}
        />
      )}
      {content && (
        <div className="px-2 py-2 body-md-regular text-text-primary" data-testid="agent-content-markdown">
          <Markdown content={content} />
        </div>
      )}
    </div>
  )
}
