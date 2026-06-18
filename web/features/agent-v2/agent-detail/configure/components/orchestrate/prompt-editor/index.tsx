'use client'

import type { KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { SlashMenuCategory, SlashMenuView } from './slash'
import type { RosterReferenceToken } from '@/app/components/base/prompt-editor/plugins/roster-reference-block/utils'
import type { AgentTool } from '@/features/agent-v2/agent-composer/form-state'
import { cn } from '@langgenius/dify-ui/cn'
import { Kbd } from '@langgenius/dify-ui/kbd'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useClipboard } from 'foxact/use-clipboard'
import { useAtom, useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import PromptEditor from '@/app/components/base/prompt-editor'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import { agentComposerFilesAtom } from '@/features/agent-v2/agent-composer/store-modules/files'
import { agentComposerKnowledgeRetrievalsAtom } from '@/features/agent-v2/agent-composer/store-modules/knowledge'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { agentComposerSkillsAtom } from '@/features/agent-v2/agent-composer/store-modules/skills'
import { agentComposerToolsAtom } from '@/features/agent-v2/agent-composer/store-modules/tools'
import useTheme from '@/hooks/use-theme'
import { Theme } from '@/types/app'
import { useAgentOrchestrateAddActions } from '../add-actions-context'
import { useAgentOrchestrateReadOnly } from '../read-only-context'
import { replaceTrailingSlashWithToken } from './options'
import { AgentPromptSlashMenu } from './slash'

const subscribeHydrationState = () => () => {}

const useIsHydrated = () => useSyncExternalStore(
  subscribeHydrationState,
  () => true,
  () => false,
)

function AgentPromptPlaceholder({
  insertLabel,
  text,
}: {
  insertLabel: string
  text: string
}) {
  return (
    <span className="flex items-center gap-0.5 system-sm-regular whitespace-nowrap text-components-input-text-placeholder">
      <span>{text}</span>
      <Kbd className="text-text-placeholder">
        /
      </Kbd>
      <span className="underline decoration-dotted underline-offset-2">
        {insertLabel}
      </span>
    </span>
  )
}

function getProviderToolFromToken(token: RosterReferenceToken, tools: AgentTool[]) {
  if (token.kind !== 'tool' && token.kind !== 'tool-all')
    return

  return tools.find(tool =>
    tool.kind === 'provider'
    && (
      token.id === `${tool.id}/*`
      || tool.actions.some(action => token.id === `${tool.id}/${action.toolName}`)
    ),
  )
}

function AgentPromptRosterReferenceIcon({
  token,
  tools,
}: {
  token: RosterReferenceToken
  tools: AgentTool[]
}) {
  const { theme } = useTheme()

  if (token.kind === 'cli_tool') {
    return (
      <span
        aria-hidden
        className="i-ri-terminal-box-line size-3.5 shrink-0 text-text-primary-on-surface"
      />
    )
  }

  const providerTool = getProviderToolFromToken(token, tools)
  if (!providerTool || providerTool.kind !== 'provider')
    return null

  const icon = theme === Theme.dark && providerTool.iconDark ? providerTool.iconDark : providerTool.icon

  if (icon) {
    return (
      <BlockIcon
        className="shrink-0"
        type={BlockEnum.Tool}
        size="xs"
        toolIcon={icon}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={cn('size-3.5 shrink-0', providerTool.iconClassName)}
    />
  )
}

const getLastTextContent = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE)
    return node.textContent ?? ''

  const textParts: string[] = []
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    textParts.push(current.textContent ?? '')
    current = walker.nextNode()
  }

  return textParts.join('')
}

const isSelectionAfterSlash = (rootElement: HTMLElement | null, fallbackValue: string) => {
  if (!rootElement)
    return fallbackValue.endsWith('/')

  const selection = window.getSelection()
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0)
    return fallbackValue.endsWith('/')

  const anchorNode = selection.anchorNode
  if (!anchorNode || !rootElement.contains(anchorNode))
    return false

  if (anchorNode.nodeType === Node.TEXT_NODE)
    return (anchorNode.textContent ?? '').slice(0, selection.anchorOffset).endsWith('/')

  const element = anchorNode as Element
  const previousChild = element.childNodes.item(selection.anchorOffset - 1)
  return previousChild ? getLastTextContent(previousChild).endsWith('/') : false
}

export function AgentPromptEditor() {
  const { t } = useTranslation('agentV2')
  const readOnly = useAgentOrchestrateReadOnly()
  const [value, setValue] = useAtom(agentComposerPromptAtom)
  const skills = useAtomValue(agentComposerSkillsAtom)
  const files = useAtomValue(agentComposerFilesAtom)
  const [tools, setTools] = useAtom(agentComposerToolsAtom)
  const retrievals = useAtomValue(agentComposerKnowledgeRetrievalsAtom)
  const addActions = useAgentOrchestrateAddActions()
  const isHydrated = useIsHydrated()
  const promptTip = t('agentDetail.configure.prompt.tip')
  const promptPlaceholder = (
    <AgentPromptPlaceholder
      text={t('agentDetail.configure.prompt.placeholder')}
      insertLabel={t('agentDetail.configure.prompt.insert.label').toLocaleLowerCase()}
    />
  )
  const { copied, copy, reset } = useClipboard({
    onCopyError: () => {
      toast.error(t('agentDetail.configure.prompt.copyFailed'))
    },
  })
  const [slashMenuView, setSlashMenuView] = useState<SlashMenuView>('main')
  const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)

  const handleCopyPrompt = useCallback(() => {
    void copy(value)
  }, [copy, value])

  const closeSlashMenu = () => {
    setIsSlashMenuOpen(false)
    setSlashMenuView('main')
  }

  const openSlashMenu = () => {
    setSlashMenuView('main')
    setIsSlashMenuOpen(true)
  }

  const syncSlashMenuWithSelection = useCallback(() => {
    if (!isHydrated || readOnly)
      return

    if (isSelectionAfterSlash(editorRef.current, value))
      openSlashMenu()
    else
      closeSlashMenu()
  }, [isHydrated, readOnly, value])

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isHydrated || readOnly)
      return

    if (event.key === 'Escape' && isSlashMenuOpen) {
      event.preventDefault()
      closeSlashMenu()
      return
    }

    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey)
      return

    openSlashMenu()
  }

  const handleEditorKeyUp = () => {
    window.requestAnimationFrame(syncSlashMenuWithSelection)
  }

  const handleEditorPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target
    if (
      target instanceof Element
      && target.closest('[data-agent-prompt-toolbar]')
    ) {
      return
    }

    window.requestAnimationFrame(syncSlashMenuWithSelection)
  }

  const handleRootPointerDown = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Node))
      return

    if (editorRef.current?.contains(target))
      return

    if (
      target instanceof Element
      && (
        target.closest('[data-agent-prompt-slash-menu]')
        || target.closest('[data-agent-prompt-toolbar]')
      )
    ) {
      return
    }

    closeSlashMenu()
  }

  const handleSlashSelect = (token: string) => {
    setValue(replaceTrailingSlashWithToken(value, token))
    closeSlashMenu()
  }

  const handleInsertSlash = () => {
    setValue(`${value}/`)
    openSlashMenu()
  }

  const renderRosterReferenceIcon = useCallback((token: RosterReferenceToken) => {
    if (token.kind !== 'tool' && token.kind !== 'tool-all' && token.kind !== 'cli_tool')
      return null

    return <AgentPromptRosterReferenceIcon token={token} tools={tools} />
  }, [tools])

  useEffect(() => {
    if (!isSlashMenuOpen)
      return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node))
        return

      if (!rootRef.current?.contains(target))
        closeSlashMenu()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isSlashMenuOpen])

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
        <Tooltip>
          <TooltipTrigger
            render={(
              <button
                type="button"
                aria-label={copied ? t('agentDetail.configure.prompt.copied') : t('agentDetail.configure.prompt.copy')}
                className="flex size-6 shrink-0 items-center justify-center rounded-md p-0.5 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                onClick={handleCopyPrompt}
                onMouseLeave={reset}
              >
                <span aria-hidden className={copied ? 'i-ri-check-line size-4' : 'i-ri-clipboard-line size-4'} />
              </button>
            )}
          />
          <TooltipContent>
            {copied ? t('agentDetail.configure.prompt.copied') : t('agentDetail.configure.prompt.copy')}
          </TooltipContent>
        </Tooltip>
      </div>

      <div
        ref={rootRef}
        className="relative"
        onPointerDownCapture={handleRootPointerDown}
      >
        <div
          className="group min-h-28 overflow-hidden rounded-[10px] border-[1.5px] border-transparent bg-components-input-bg-normal pt-1 focus-within:border-components-input-border-active-prompt-1 focus-within:bg-components-input-bg-active focus-within:shadow-xs focus-within:shadow-shadow-shadow-3"
          onKeyDownCapture={handleEditorKeyDown}
          onKeyUpCapture={handleEditorKeyUp}
          onPointerUpCapture={handleEditorPointerUp}
        >
          <div ref={editorRef} className="min-h-[72px] overflow-y-auto px-3 pt-0.5">
            <PromptEditor
              instanceId="agent-configure-prompt-editor"
              compact
              wrapperClassName="min-h-[72px]"
              className="min-h-[72px] text-text-primary"
              placeholder={promptPlaceholder}
              placeholderClassName="top-0!"
              editable={!readOnly}
              value={value}
              onChange={setValue}
              variableBlock={{
                show: true,
              }}
              rosterReferenceBlock={{
                show: true,
                renderIcon: renderRosterReferenceIcon,
              }}
              disableSlashPicker
              disableBracePicker
            />
          </div>
          {!readOnly && (
            <div
              data-agent-prompt-toolbar
              className="flex h-8 shrink-0 items-center justify-between px-3 text-text-tertiary opacity-0 transition-opacity group-focus-within:opacity-100"
            >
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  className="flex items-center gap-1 system-xs-medium hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                  onClick={handleInsertSlash}
                >
                  <span aria-hidden className="i-ri-slash-commands-2 size-3.5" />
                  {t('agentDetail.configure.prompt.insert.label')}
                </button>
              </div>
              <div className="rounded-sm border border-divider-regular bg-background-default px-1 system-2xs-regular text-text-tertiary">
                {value.length}
              </div>
            </div>
          )}
        </div>

        {isHydrated && !readOnly && isSlashMenuOpen && (
          <div data-agent-prompt-slash-menu className="absolute top-9 left-3 z-50">
            <AgentPromptSlashMenu
              view={slashMenuView}
              categories={slashMenuCategories}
              skills={skills}
              files={files}
              tools={tools}
              onToolsChange={setTools}
              onAddCliTool={addActions.cli}
              onAddFile={addActions.files}
              onAddKnowledge={addActions.knowledge}
              onAddSkill={addActions.skills}
              retrievals={retrievals}
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
