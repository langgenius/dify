'use client'

import type { KeyboardEvent } from 'react'
import type { SlashMenuCategory, SlashMenuView } from './slash-menu'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import PromptEditor from '@/app/components/base/prompt-editor'
import {
  defaultAgentFiles,
  defaultAgentKnowledgeRetrievals,
  defaultAgentSkills,
  defaultAgentTools,
} from '../configured-data'
import { AgentPromptOptionMenu } from './prompt-option-menu'
import { appendToken, insertOptions, mentionOptions, replaceTrailingSlashWithToken } from './prompt-options'
import { AgentPromptSlashMenu } from './slash-menu'

type AgentPromptEditorProps = {
  value: string
  onChange: (value: string) => void
}

const subscribeHydrationState = () => () => {}

const useIsHydrated = () => useSyncExternalStore(
  subscribeHydrationState,
  () => true,
  () => false,
)

export function AgentPromptEditor({
  value,
  onChange,
}: AgentPromptEditorProps) {
  const { t } = useTranslation('agentV2')
  const isHydrated = useIsHydrated()
  const promptTip = t('agentDetail.configure.prompt.tip')
  const count = value.length
  const [slashMenuView, setSlashMenuView] = useState<SlashMenuView>('main')
  const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false)

  const handleInsert = useCallback((token: string) => {
    onChange(appendToken(value, token))
  }, [onChange, value])

  const closeSlashMenu = () => {
    setIsSlashMenuOpen(false)
    setSlashMenuView('main')
  }

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isHydrated)
      return

    if (event.key === 'Escape' && isSlashMenuOpen) {
      event.preventDefault()
      closeSlashMenu()
      return
    }

    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey)
      return

    setSlashMenuView('main')
    setIsSlashMenuOpen(true)
  }

  const handleSlashSelect = (token: string) => {
    onChange(replaceTrailingSlashWithToken(value, token))
    closeSlashMenu()
  }

  const slashMenuCategories: SlashMenuCategory[] = [
    {
      key: 'skills',
      label: t('agentDetail.configure.skills.label'),
      icon: 'i-ri-box-3-line',
    },
    {
      key: 'files',
      label: t('agentDetail.configure.files.label'),
      icon: 'i-ri-file-line',
    },
    {
      key: 'tools',
      label: t('agentDetail.configure.tools.label'),
      icon: 'i-ri-box-3-line',
    },
    {
      key: 'knowledge',
      label: t('agentDetail.configure.knowledgeRetrieval.label'),
      icon: 'i-ri-book-open-line',
    },
  ]

  return (
    <section className="flex flex-col gap-1 px-0 py-0" aria-labelledby="agent-configure-prompt-label">
      <div className="flex items-center gap-2">
        <div className="flex min-h-6 min-w-0 flex-1 items-center gap-0.5">
          <h3
            id="agent-configure-prompt-label"
            className="truncate system-sm-semibold-uppercase text-text-secondary"
          >
            {t('agentDetail.configure.prompt.label')}
          </h3>
          <Infotip aria-label={promptTip} popupClassName="max-w-64">
            {promptTip}
          </Infotip>
        </div>
      </div>

      <div className="relative">
        <div
          className="overflow-hidden rounded-[10px] border-[1.5px] border-components-input-border-active-prompt-1 bg-components-input-bg-active shadow-xs shadow-shadow-shadow-3"
          onKeyDownCapture={handleEditorKeyDown}
        >
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
              rosterReferenceBlock={{
                show: true,
              }}
              disableSlashPicker
              disableBracePicker
            />
          </div>

          <div className="flex min-h-9 items-center gap-2 px-2.5 py-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              <AgentPromptOptionMenu
                label={t('agentDetail.configure.prompt.insert.label')}
                icon="i-custom-vender-agent-v2-prompt-insert"
                options={insertOptions}
                onInsert={handleInsert}
              />
              <AgentPromptOptionMenu
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

        {isHydrated && isSlashMenuOpen && (
          <div className="absolute top-9 left-3 z-50">
            <AgentPromptSlashMenu
              view={slashMenuView}
              categories={slashMenuCategories}
              skills={defaultAgentSkills}
              files={defaultAgentFiles}
              tools={defaultAgentTools}
              retrievals={defaultAgentKnowledgeRetrievals}
              onBack={() => setSlashMenuView('main')}
              onOpenCategory={setSlashMenuView}
              onSelect={handleSlashSelect}
            />
          </div>
        )}
      </div>
    </section>
  )
}
