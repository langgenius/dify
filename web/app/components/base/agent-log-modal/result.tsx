'use client'
import type { AgentLogResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import StatusPanel from '@/app/components/workflow/run/status'
import useTimestamp from '@/hooks/use-timestamp'

type ResultPanelProps = Readonly<{
  meta: AgentLogResponse['meta']
  inputs?: unknown
  outputs: string
  tools: string[]
}>

const ResultPanel: FC<ResultPanelProps> = ({ meta, inputs, outputs, tools }) => {
  const { t } = useTranslation(['appDebug', 'appLog', 'runLog'])
  const { formatTime } = useTimestamp()

  return (
    <div className="bg-components-panel-bg py-2">
      <div className="px-4 py-2">
        <StatusPanel status="succeeded" time={meta.elapsed_time} tokens={meta.total_tokens} />
      </div>
      <div className="flex flex-col gap-2 px-4 py-2">
        <CodeEditor
          readOnly
          title={<div>INPUT</div>}
          language={CodeLanguage.json}
          value={typeof inputs === 'string' ? inputs : JSON.stringify(inputs, null, 2)}
        />
        <CodeEditor
          readOnly
          title={<div>OUTPUT</div>}
          language={CodeLanguage.json}
          value={outputs}
        />
      </div>
      <div className="px-4 py-2">
        <div className="h-[0.5px] bg-divider-regular opacity-5" />
      </div>
      <div className="px-4 py-2">
        <div className="relative">
          <div className="h-6 text-xs/6 font-medium text-text-tertiary">
            {t(($) => $['meta.title'], { ns: 'runLog' })}
          </div>
          <div className="py-1">
            <div className="flex">
              <div className="w-26 shrink-0 truncate px-2 py-1.25 text-xs leading-4.5 text-text-tertiary">
                {t(($) => $['meta.status'], { ns: 'runLog' })}
              </div>
              <div className="grow px-2 py-1.25 text-xs leading-4.5 text-text-primary">
                <span>SUCCESS</span>
              </div>
            </div>
            <div className="flex">
              <div className="w-26 shrink-0 truncate px-2 py-1.25 text-xs leading-4.5 text-text-tertiary">
                {t(($) => $['meta.executor'], { ns: 'runLog' })}
              </div>
              <div className="grow px-2 py-1.25 text-xs leading-4.5 text-text-primary">
                <span>{meta.executor || 'N/A'}</span>
              </div>
            </div>
            <div className="flex">
              <div className="w-26 shrink-0 truncate px-2 py-1.25 text-xs leading-4.5 text-text-tertiary">
                {t(($) => $['meta.startTime'], { ns: 'runLog' })}
              </div>
              <div className="grow px-2 py-1.25 text-xs leading-4.5 text-text-primary">
                <span>
                  {formatTime(
                    Date.parse(meta.start_time) / 1000,
                    t(($) => $.dateTimeFormat, { ns: 'appLog' }) as string,
                  )}
                </span>
              </div>
            </div>
            <div className="flex">
              <div className="w-26 shrink-0 truncate px-2 py-1.25 text-xs leading-4.5 text-text-tertiary">
                {t(($) => $['meta.time'], { ns: 'runLog' })}
              </div>
              <div className="grow px-2 py-1.25 text-xs leading-4.5 text-text-primary">
                <span>{`${meta.elapsed_time.toFixed(3)}s`}</span>
              </div>
            </div>
            <div className="flex">
              <div className="w-26 shrink-0 truncate px-2 py-1.25 text-xs leading-4.5 text-text-tertiary">
                {t(($) => $['meta.tokens'], { ns: 'runLog' })}
              </div>
              <div className="grow px-2 py-1.25 text-xs leading-4.5 text-text-primary">
                <span>{`${meta.total_tokens} Tokens`}</span>
              </div>
            </div>
            <div className="flex">
              <div className="w-26 shrink-0 truncate px-2 py-1.25 text-xs leading-4.5 text-text-tertiary">
                {t(($) => $['agentLogDetail.agentMode'], { ns: 'appLog' })}
              </div>
              <div className="grow px-2 py-1.25 text-xs leading-4.5 text-text-primary">
                <span>
                  {meta.agent_mode === 'function_call'
                    ? t(($) => $['agent.agentModeType.functionCall'], { ns: 'appDebug' })
                    : t(($) => $['agent.agentModeType.ReACT'], { ns: 'appDebug' })}
                </span>
              </div>
            </div>
            <div className="flex">
              <div className="w-26 shrink-0 truncate px-2 py-1.25 text-xs leading-4.5 text-text-tertiary">
                {t(($) => $['agentLogDetail.toolUsed'], { ns: 'appLog' })}
              </div>
              <div className="grow px-2 py-1.25 text-xs leading-4.5 text-text-primary">
                <span>{tools.length ? tools.join(', ') : 'Null'}</span>
              </div>
            </div>
            <div className="flex">
              <div className="w-26 shrink-0 truncate px-2 py-1.25 text-xs leading-4.5 text-text-tertiary">
                {t(($) => $['agentLogDetail.iterations'], { ns: 'appLog' })}
              </div>
              <div className="grow px-2 py-1.25 text-xs leading-4.5 text-text-primary">
                <span>{meta.iterations}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ResultPanel
