import type { ReactNode } from 'react'
import type { ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { ChatItem } from '@/app/components/base/chat/types'
import type { Locale } from '@/i18n-config'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileList } from '@/app/components/base/file-uploader'
import { Markdown } from '@/app/components/base/markdown'
import { renderI18nObject } from '@/i18n-config'
import { getLanguage } from '@/i18n-config/language'

type AgentRosterResponseContentProps = {
  item: ChatItem
  responding?: boolean
  content?: string
}

const SHELL_TOOL_NAMES = new Set(['shell_run', 'shell_wait', 'shell_input', 'shell_interrupt'])

type ToolActivity = {
  kind: 'shell' | 'tool'
  key: string
  name: string
  label: string
  input: string
  output: string
  isFinished: boolean
}

type TimelinePart =
  | {
      type: 'message'
      content: string
      key: string
    }
  | {
      type: 'thought'
      thought: ThoughtItem
      key: string
    }

function readIndexedValue(value: string, isArray: boolean, index: number) {
  if (!isArray) return value

  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? String(parsed[index] ?? '') : value
  } catch {
    return value
  }
}

function getToolActivities(
  thought: ThoughtItem,
  language: string,
  responding?: boolean,
): ToolActivity[] {
  let toolNames = [thought.tool]
  let isArray = false

  try {
    const parsed = JSON.parse(thought.tool) as unknown
    if (Array.isArray(parsed)) {
      toolNames = parsed.map((item) => String(item))
      isArray = true
    }
  } catch {}

  const labelLanguage = getLanguage(language as Locale)

  return toolNames.filter(Boolean).map((name, index) => ({
    kind: SHELL_TOOL_NAMES.has(name) ? 'shell' : 'tool',
    key: `${name}-${index}`,
    name,
    label: renderI18nObject(thought.tool_labels?.[name] ?? {}, labelLanguage) || name,
    input: readIndexedValue(thought.tool_input, isArray, index),
    output: readIndexedValue(thought.observation, isArray, index),
    isFinished: !!thought.observation || !responding,
  }))
}

function formatDuration(seconds: number, t: ReturnType<typeof useTranslation<'agentV2'>>['t']) {
  const safeSeconds = Math.max(0, seconds)
  if (safeSeconds < 60) {
    return t(($) => $['agentDetail.configure.answer.duration.second'], {
      count: Number(safeSeconds.toFixed(2)),
    })
  }

  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = Math.floor(safeSeconds % 60)

  return [
    t(($) => $['agentDetail.configure.answer.duration.minute'], { count: minutes }),
    t(($) => $['agentDetail.configure.answer.duration.second'], { count: remainingSeconds }),
  ].join('')
}

function getThoughtKey(thought: ThoughtItem) {
  return thought.id || `${thought.message_id}-${thought.position}`
}

function hashString(value: string) {
  let hash = 5381
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash) ^ value.charCodeAt(i)

  return (hash >>> 0).toString(36)
}

function hasVisibleActivity(thought: ThoughtItem) {
  return !!thought.tool || !!thought.message_files?.length
}

function getTimelineParts(item: ChatItem): TimelinePart[] {
  if (item.agent_response_parts?.length) {
    const keyOccurrences = new Map<string, number>()

    return item.agent_response_parts.flatMap<TimelinePart>((part) => {
      const baseKey =
        part.type === 'message'
          ? `message-${part.content.length}-${hashString(part.content)}`
          : `thought-${getThoughtKey(part.thought)}`
      const occurrence = keyOccurrences.get(baseKey) ?? 0
      keyOccurrences.set(baseKey, occurrence + 1)
      const key = occurrence ? `${baseKey}-${occurrence}` : baseKey

      if (part.type === 'message')
        return part.content ? [{ type: 'message', content: part.content, key }] : []

      return hasVisibleActivity(part.thought)
        ? [{ type: 'thought', thought: part.thought, key }]
        : []
    })
  }

  return [...(item.agent_thoughts ?? [])]
    .sort((left, right) => left.position - right.position)
    .flatMap((thought) => {
      const parts: TimelinePart[] = []
      const key = getThoughtKey(thought)
      const answer = thought.answer?.trim()
      if (answer) {
        parts.push({ type: 'message', content: answer, key: `message-${key}` })
      } else if (hasVisibleActivity(thought)) {
        parts.push({ type: 'thought', thought, key: `thought-${key}` })
      }

      return parts
    })
}

function useWorkingDuration(enabled?: boolean) {
  const startedAtRef = useRef<number | null>(null)
  const [now, setNow] = useState(0)

  useEffect(() => {
    if (!enabled) return

    startedAtRef.current ??= Date.now()
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [enabled])

  if (!enabled || startedAtRef.current === null) return 0
  return Math.max(0, Math.floor((now - startedAtRef.current) / 1000))
}

function TimelineMessage({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-full min-w-0 overflow-hidden py-2 body-md-regular text-text-primary">
      {children}
    </div>
  )
}

function ToolActivityItem({ tool }: { tool: ToolActivity }) {
  const { t } = useTranslation()
  const hasDetails = !!tool.input || !!tool.output
  const label =
    tool.name === 'shell_run' && tool.label === tool.name
      ? tool.isFinished
        ? t(($) => $['agentDetail.configure.answer.activity.ranCommands'], { ns: 'agentV2' })
        : t(($) => $['agentDetail.configure.answer.activity.runningCommands'], {
            ns: 'agentV2',
          })
      : tool.label

  const content = (
    <>
      <span className="inline-flex min-w-0 items-center gap-1">
        <span className="flex size-3.5 shrink-0 items-center justify-center text-text-tertiary">
          {!tool.isFinished ? (
            <span className="i-ri-loader-2-line size-3.5 animate-spin" aria-hidden />
          ) : tool.kind === 'shell' ? (
            <span className="i-ri-terminal-box-line size-3.5" aria-hidden />
          ) : (
            <span className="i-ri-hammer-line size-3.5" aria-hidden />
          )}
        </span>
        <span className="min-w-0 truncate text-text-secondary">{label}</span>
      </span>
      {hasDetails && (
        <span
          className="i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary transition-transform duration-100 ease-out group-data-panel-open/tool:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
      )}
    </>
  )

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col items-start">
      {hasDetails ? (
        <Collapsible className="w-full max-w-full items-start">
          <CollapsibleTrigger className="group/tool h-6 min-h-0 w-auto max-w-full justify-start gap-0 rounded-md p-1 text-left system-xs-medium text-text-tertiary hover:not-data-disabled:bg-state-base-hover focus-visible:bg-state-base-hover">
            {content}
          </CollapsibleTrigger>
          <CollapsiblePanel className="w-full max-w-full">
            <div className="w-full max-w-full min-w-0 space-y-1 pb-1">
              {!!tool.input && (
                <div className="w-full max-w-full min-w-0 overflow-hidden rounded-lg bg-components-input-bg-normal px-3 py-2">
                  <div className="system-xs-semibold-uppercase text-text-tertiary">
                    {t(($) => $['thought.requestTitle'], { ns: 'tools' })}
                  </div>
                  <div className="mt-1 max-w-full min-w-0 code-xs-regular wrap-break-word whitespace-pre-wrap text-text-secondary">
                    {tool.input}
                  </div>
                </div>
              )}
              {!!tool.output && (
                <div className="w-full max-w-full min-w-0 overflow-hidden rounded-lg bg-components-input-bg-normal px-3 py-2">
                  <div className="system-xs-semibold-uppercase text-text-tertiary">
                    {t(($) => $['thought.responseTitle'], { ns: 'tools' })}
                  </div>
                  <div className="mt-1 max-w-full min-w-0 code-xs-regular wrap-break-word whitespace-pre-wrap text-text-secondary">
                    {tool.output}
                  </div>
                </div>
              )}
            </div>
          </CollapsiblePanel>
        </Collapsible>
      ) : (
        <div className="inline-flex h-6 w-auto max-w-full items-center rounded-md p-1 system-xs-medium">
          {content}
        </div>
      )}
    </div>
  )
}

function ActivityTimelinePart({
  thought,
  responding,
}: {
  thought: ThoughtItem
  responding?: boolean
}) {
  const { i18n } = useTranslation()
  const tools = getToolActivities(thought, i18n.language, responding)

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-1">
      {tools.map((tool) => (
        <ToolActivityItem key={`${getThoughtKey(thought)}-${tool.key}`} tool={tool} />
      ))}
      {!!thought.message_files?.length && (
        <FileList
          className="py-1"
          files={thought.message_files}
          showDeleteAction={false}
          showDownloadAction
          canPreview
        />
      )}
    </div>
  )
}

function ThinkingTimeline({
  item,
  parts,
  responding,
}: {
  item: ChatItem
  parts: TimelinePart[]
  responding?: boolean
}) {
  const { t } = useTranslation('agentV2')
  const hasPublicMessage = parts.some((part) => part.type === 'message')
  const workingDuration = useWorkingDuration(responding)
  const latency = Number(item.more?.latency)
  const duration = responding
    ? formatDuration(workingDuration, t)
    : Number.isFinite(latency) && latency > 0
      ? formatDuration(latency, t)
      : undefined
  const thinking = t(($) => $['agentDetail.configure.answer.thinking'])
  const title = duration ? `${thinking} · ${duration}` : thinking

  return (
    <Collapsible className="w-full max-w-full" defaultOpen={!!responding && !hasPublicMessage}>
      <CollapsibleTrigger className="group/thinking h-9 min-h-0 w-full justify-start gap-1 rounded-md border-b border-divider-subtle px-0 text-left hover:not-data-disabled:bg-transparent">
        <span className="system-md-regular text-text-tertiary">{title}</span>
        <span
          className="i-ri-arrow-right-s-line size-4 transition-transform duration-100 ease-out group-data-panel-open/thinking:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsiblePanel className="w-full max-w-full">
        <div className="mt-1 flex w-full max-w-full min-w-0">
          <div className="ml-2 w-5 shrink-0 border-l border-divider-subtle" />
          <div className="max-w-full min-w-0 flex-1 overflow-hidden">
            {parts.map((part) =>
              part.type === 'message' ? (
                <TimelineMessage key={part.key}>
                  <Markdown content={part.content} />
                </TimelineMessage>
              ) : (
                <ActivityTimelinePart
                  key={part.key}
                  thought={part.thought}
                  responding={responding}
                />
              ),
            )}
          </div>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  )
}

export function AgentRosterResponseContent({
  item,
  responding,
  content,
}: AgentRosterResponseContentProps) {
  if (item.annotation?.logAnnotation) {
    return (
      <Markdown
        content={item.annotation.logAnnotation.content || ''}
        data-testid="agent-content-markdown"
      />
    )
  }

  const timelineParts = getTimelineParts(item)
  const timelineState = !responding
    ? 'complete'
    : timelineParts.some((part) => part.type === 'message')
      ? 'responding-message'
      : 'responding-thinking'
  const finalContent = item.agent_response_parts?.length ? undefined : content

  return (
    <div
      className="flex w-full max-w-full min-w-0 flex-col gap-1 overflow-hidden"
      data-testid="agent-roster-response-content"
    >
      {!!timelineParts.length && (
        <ThinkingTimeline
          key={timelineState}
          item={item}
          parts={timelineParts}
          responding={responding}
        />
      )}
      {finalContent && (
        <div
          className="px-2 py-2 body-md-regular text-text-primary"
          data-testid="agent-content-markdown"
        >
          <Markdown content={finalContent} />
        </div>
      )}
    </div>
  )
}
