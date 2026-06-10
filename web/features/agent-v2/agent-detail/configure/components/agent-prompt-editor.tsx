'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import PromptEditor from '@/app/components/base/prompt-editor'

type AgentPromptEditorProps = {
  value: string
  onChange: (value: string) => void
}

type InsertOption = {
  key: string
  labelKey: AgentPromptOptionLabelKey
  token: string
  icon: string
}

type AgentPromptOptionLabelKey
  = | 'agentDetail.configure.prompt.insert.tenders'
    | 'agentDetail.configure.prompt.insert.question'
    | 'agentDetail.configure.prompt.insert.reportFile'
    | 'agentDetail.configure.prompt.mention.davidHayes'
    | 'agentDetail.configure.prompt.mention.priyaRamanathan'

const insertOptions: InsertOption[] = [
  {
    key: 'tenders',
    labelKey: 'agentDetail.configure.prompt.insert.tenders',
    token: '{{tenders}}',
    icon: 'i-ri-home-4-line',
  },
  {
    key: 'question',
    labelKey: 'agentDetail.configure.prompt.insert.question',
    token: '{{question}}',
    icon: 'i-ri-question-answer-line',
  },
  {
    key: 'reportFile',
    labelKey: 'agentDetail.configure.prompt.insert.reportFile',
    token: '{{qna_report_pdf}}',
    icon: 'i-ri-file-pdf-2-line',
  },
]

const mentionOptions: InsertOption[] = [
  {
    key: 'davidHayes',
    labelKey: 'agentDetail.configure.prompt.mention.davidHayes',
    token: '{{DavidHayes}}',
    icon: 'i-ri-user-line',
  },
  {
    key: 'priyaRamanathan',
    labelKey: 'agentDetail.configure.prompt.mention.priyaRamanathan',
    token: '{{PriyaRamanathan}}',
    icon: 'i-ri-user-line',
  },
]

const appendToken = (value: string, token: string) => {
  if (!value)
    return token

  return `${value}${value.endsWith(' ') || value.endsWith('\n') ? '' : ' '}${token}`
}

export function AgentPromptEditor({
  value,
  onChange,
}: AgentPromptEditorProps) {
  const { t } = useTranslation('agentV2')
  const promptTip = t('agentDetail.configure.prompt.tip')
  const count = value.length
  const handleInsert = (token: string) => {
    onChange(appendToken(value, token))
  }

  return (
    <section className="mb-4 flex flex-col gap-1 px-0 py-0" aria-labelledby="agent-configure-prompt-label">
      <div className="flex items-center gap-2">
        <div className="flex min-h-6 min-w-0 flex-1 items-center gap-0.5">
          <h3
            id="agent-configure-prompt-label"
            className="truncate system-sm-semibold-uppercase text-text-secondary"
          >
            {t('agentDetail.configure.prompt.label')}
          </h3>
          <Tooltip>
            <TooltipTrigger
              render={(
                <button
                  type="button"
                  aria-label={promptTip}
                  className="flex size-4 shrink-0 items-center justify-center rounded-sm text-text-quaternary hover:text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                >
                  <span aria-hidden className="i-ri-question-line size-3.5" />
                </button>
              )}
            />
            <TooltipContent placement="top" className="max-w-64">
              {promptTip}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="overflow-hidden rounded-[10px] border-[1.5px] border-components-input-border-active-prompt-1 bg-components-input-bg-active shadow-xs shadow-shadow-shadow-3">
        <div className="max-h-64 min-h-20 overflow-y-auto px-3 pt-2">
          <PromptEditor
            instanceId="agent-configure-prompt-editor"
            compact
            wrapperClassName="min-h-20"
            className="min-h-20 text-text-primary"
            placeholder={t('agentDetail.configure.prompt.placeholder')}
            value={value}
            onChange={onChange}
            variableBlock={{
              show: true,
            }}
          />
        </div>

        <div className="flex min-h-9 items-center gap-2 px-2.5 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            <AgentPromptMenu
              label={t('agentDetail.configure.prompt.insert.label')}
              icon="i-custom-vender-agent-v2-prompt-insert"
              options={insertOptions}
              onInsert={handleInsert}
            />
            <AgentPromptMenu
              label={t('agentDetail.configure.prompt.mention.label')}
              icon="i-ri-at-line"
              options={mentionOptions}
              onInsert={handleInsert}
            />
          </div>

          <div className="min-w-4 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 text-center system-2xs-medium-uppercase text-text-tertiary">
            {count}
          </div>
        </div>
      </div>
    </section>
  )
}

function AgentPromptMenu({
  label,
  icon,
  options,
  onInsert,
}: {
  label: string
  icon: string
  options: InsertOption[]
  onInsert: (token: string) => void
}) {
  const { t } = useTranslation('agentV2')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <button
            type="button"
            className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden className={`${icon} size-3.5`} />
            <span className="system-xs-medium">{label}</span>
          </button>
        )}
      />
      <DropdownMenuContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="w-60 p-1"
      >
        {options.map(option => (
          <DropdownMenuItem
            key={option.key}
            className="gap-2"
            onClick={() => onInsert(option.token)}
          >
            <span aria-hidden className={`${option.icon} size-4 text-text-tertiary`} />
            <span className="min-w-0 flex-1 truncate">{t(option.labelKey)}</span>
            <span className="code-xs-regular text-text-quaternary">{option.token}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
