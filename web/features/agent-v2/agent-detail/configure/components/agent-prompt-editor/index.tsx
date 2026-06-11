'use client'

import type { KeyboardEvent, MouseEvent } from 'react'
import type { SlashMenuCategory, SlashMenuView } from './slash-menu'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import PromptEditor from '@/app/components/base/prompt-editor'
import {
  useAgentConfigureFiles,
  useAgentConfigureKnowledgeRetrievals,
  useAgentConfigurePrompt,
  useAgentConfigureSkills,
  useAgentConfigureTools,
} from '../../atoms'
import { AgentPromptOptionMenu } from './prompt-option-menu'
import { appendToken, insertOptions, mentionOptions, replaceTrailingSlashWithToken } from './prompt-options'
import { AgentPromptSlashMenu } from './slash-menu'

const subscribeHydrationState = () => () => {}

const useIsHydrated = () => useSyncExternalStore(
  subscribeHydrationState,
  () => true,
  () => false,
)

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
  const [value, onChange] = useAgentConfigurePrompt()
  const [skills] = useAgentConfigureSkills()
  const [files] = useAgentConfigureFiles()
  const [tools] = useAgentConfigureTools()
  const [retrievals] = useAgentConfigureKnowledgeRetrievals()
  const isHydrated = useIsHydrated()
  const promptTip = t('agentDetail.configure.prompt.tip')
  const count = value.length
  const [slashMenuView, setSlashMenuView] = useState<SlashMenuView>('main')
  const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)

  const handleInsert = useCallback((token: string) => {
    onChange(appendToken(value, token))
  }, [onChange, value])

  const closeSlashMenu = () => {
    setIsSlashMenuOpen(false)
    setSlashMenuView('main')
  }

  const openSlashMenu = () => {
    setSlashMenuView('main')
    setIsSlashMenuOpen(true)
  }

  const syncSlashMenuWithSelection = useCallback(() => {
    if (!isHydrated)
      return

    if (isSelectionAfterSlash(editorRef.current, value))
      openSlashMenu()
    else
      closeSlashMenu()
  }, [isHydrated, value])

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

    openSlashMenu()
  }

  const handleEditorKeyUp = () => {
    window.requestAnimationFrame(syncSlashMenuWithSelection)
  }

  const handleEditorPointerUp = () => {
    window.requestAnimationFrame(syncSlashMenuWithSelection)
  }

  const handleRootPointerDown = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Node))
      return

    if (editorRef.current?.contains(target))
      return

    if (target instanceof Element && target.closest('[data-agent-prompt-slash-menu]'))
      return

    closeSlashMenu()
  }

  const handleSlashSelect = (token: string) => {
    onChange(replaceTrailingSlashWithToken(value, token))
    closeSlashMenu()
  }

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
      </div>

      <div
        ref={rootRef}
        className="relative"
        onPointerDownCapture={handleRootPointerDown}
      >
        <div
          className="overflow-hidden rounded-[10px] border-[1.5px] border-components-input-border-active-prompt-1 bg-components-input-bg-active shadow-xs shadow-shadow-shadow-3"
          onKeyDownCapture={handleEditorKeyDown}
          onKeyUpCapture={handleEditorKeyUp}
          onPointerUpCapture={handleEditorPointerUp}
        >
          <div ref={editorRef} className="max-h-64 min-h-20 overflow-y-auto px-3 pt-2">
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
          <div data-agent-prompt-slash-menu className="absolute top-9 left-3 z-50">
            <AgentPromptSlashMenu
              view={slashMenuView}
              categories={slashMenuCategories}
              skills={skills}
              files={files}
              tools={tools}
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
