'use client'

import type { LexicalNode } from 'lexical'
import type { KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { TextRange } from './options'
import type { SlashMenuCategory, SlashMenuView } from './slash'
import type { RosterReferenceToken } from '@/app/components/base/prompt-editor/plugins/roster-reference-block/utils'
import type { AgentFileNode, AgentProviderTool, AgentTool } from '@/features/agent-v2/agent-composer/form-state'
import { cn } from '@langgenius/dify-ui/cn'
import { Kbd } from '@langgenius/dify-ui/kbd'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { useClipboard } from 'foxact/use-clipboard'
import { useAtom, useAtomValue } from 'jotai'
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
} from 'lexical'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import PromptEditor from '@/app/components/base/prompt-editor'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import { agentComposerKnowledgeRetrievalsAtom } from '@/features/agent-v2/agent-composer/store-modules/knowledge'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { agentComposerToolsAtom } from '@/features/agent-v2/agent-composer/store-modules/tools'
import { ENABLE_AGENT_CLI_TOOLS } from '@/features/agent-v2/agent-detail/configure/feature-flags'
import { useAgentOrchestrateAddActions } from '../add-actions-context'
import { AgentConfigureTipContent } from '../common/tip-content'
import { useAgentConfigFiles, useAgentConfigSkills } from '../config-context'
import { useAgentOrchestrateReadOnly } from '../read-only-context'
import { useAgentPromptToolIconResolver } from './hooks'
import { insertTokenAtTextRange, replaceTrailingSlashWithToken } from './options'
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
      token.id === tool.id
      || token.id === `${tool.id}/*`
      || tool.actions.some(action => token.id === `${tool.id}/${action.toolName}`)
    ),
  )
}

const flattenFileNodes = (files: AgentFileNode[]): AgentFileNode[] => files.flatMap(file => (
  file.children?.length ? flattenFileNodes(file.children) : [file]
))

function AgentPromptRosterReferenceIcon({
  token,
  tools,
  getConfiguredToolIcon,
}: {
  token: RosterReferenceToken
  tools: AgentTool[]
  getConfiguredToolIcon: (tool: AgentProviderTool) => AgentProviderTool['icon']
}) {
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

  const icon = getConfiguredToolIcon(providerTool)

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

const getNodeOffset = (
  node: LexicalNode,
  anchorNode: LexicalNode,
  anchorOffset: number,
): { found: boolean, offset: number } => {
  if (node.getKey() === anchorNode.getKey())
    return { found: true, offset: anchorOffset }

  if (!$isElementNode(node))
    return { found: false, offset: node.getTextContent().length }

  let offset = 0
  for (const child of node.getChildren()) {
    const childOffset = getNodeOffset(child, anchorNode, anchorOffset)
    if (childOffset.found)
      return { found: true, offset: offset + childOffset.offset }

    offset += childOffset.offset
  }

  return { found: false, offset }
}

const getSelectionTextOffset = () => {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed())
    return null

  const anchor = selection.anchor
  const anchorNode = anchor.getNode()
  const root = $getRoot()
  let offset = 0

  for (const child of root.getChildren()) {
    const childOffset = getNodeOffset(child, anchorNode, anchor.offset)
    if (childOffset.found)
      return offset + childOffset.offset

    offset += childOffset.offset + 1
  }

  return null
}

const readSlashInsertRange = (): TextRange | null => {
  const offset = getSelectionTextOffset()
  if (!offset)
    return null

  const value = $getRoot().getChildren().map(node => node.getTextContent()).join('\n')
  if (value[offset - 1] !== '/')
    return null

  return {
    start: offset - 1,
    end: offset,
  }
}

const selectNodeTextOffset = (node: LexicalNode, textOffset: number): boolean => {
  if ($isTextNode(node)) {
    const offset = Math.max(0, Math.min(textOffset, node.getTextContentSize()))
    node.select(offset, offset)
    return true
  }

  if (!$isElementNode(node))
    return false

  const children = node.getChildren()
  let currentOffset = 0

  for (let index = 0; index < children.length; index++) {
    const child = children[index]!
    const childLength = child.getTextContent().length
    if (textOffset > currentOffset + childLength) {
      currentOffset += childLength
      continue
    }

    if ($isElementNode(child) || $isTextNode(child))
      return selectNodeTextOffset(child, textOffset - currentOffset)

    const childSelectionOffset = textOffset <= currentOffset ? index : index + 1
    node.select(childSelectionOffset, childSelectionOffset)
    return true
  }

  node.select(children.length, children.length)
  return true
}

const selectTextOffset = (textOffset: number) => {
  const root = $getRoot()
  let currentOffset = 0

  for (const child of root.getChildren()) {
    const childLength = child.getTextContent().length
    if (textOffset <= currentOffset + childLength) {
      selectNodeTextOffset(child, textOffset - currentOffset)
      return
    }

    currentOffset += childLength + 1
  }

  root.selectEnd()
}

type SelectionRestoreRequest = {
  id: number
  offset: number
}

type SlashMenuPosition = {
  left: number
  top: number
}

const slashMenuViewportPadding = 8
const slashMenuMainWidth = 200
const slashMenuSubmenuWidth = 360

const getSlashMenuPosition = (editorElement: HTMLElement): SlashMenuPosition | null => {
  const selection = window.getSelection()
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0)
    return null

  const anchorNode = selection.anchorNode
  if (!anchorNode || !editorElement.contains(anchorNode))
    return null

  const range = selection.getRangeAt(0).cloneRange()
  let rect: DOMRect | null = null
  const rects = range.getClientRects()
  if (rects.length)
    rect = rects[rects.length - 1]!
  else
    rect = range.getBoundingClientRect()

  if (!rect || (rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0)) {
    const node = anchorNode.nodeType === Node.ELEMENT_NODE
      ? anchorNode as Element
      : anchorNode.parentElement

    rect = node?.getBoundingClientRect() ?? editorElement.getBoundingClientRect()
  }

  const editorRect = editorElement.getBoundingClientRect()
  if (!rect || rect.bottom < editorRect.top || rect.top > editorRect.bottom)
    return null

  return {
    left: rect.right,
    top: rect.bottom + 4,
  }
}

const getSlashMenuLeft = (position: SlashMenuPosition, width: number) => {
  if (typeof window === 'undefined')
    return position.left

  return Math.max(
    slashMenuViewportPadding,
    Math.min(position.left, window.innerWidth - width - slashMenuViewportPadding),
  )
}

function AgentPromptSelectionBridge({
  restoreRequest,
  onSlashRangeChange,
}: {
  restoreRequest: SelectionRestoreRequest | null
  onSlashRangeChange: (range: TextRange | null) => void
}) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const updateSlashRange = () => {
      editor.getEditorState().read(() => {
        onSlashRangeChange(readSlashInsertRange())
      })

      return false
    }

    updateSlashRange()

    return mergeRegister(
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        updateSlashRange,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          onSlashRangeChange(readSlashInsertRange())
        })
      }),
    )
  }, [editor, onSlashRangeChange])

  useEffect(() => {
    if (!restoreRequest)
      return

    editor.focus(() => {
      editor.update(() => {
        selectTextOffset(restoreRequest.offset)
      })
    })
  }, [editor, restoreRequest])

  return null
}

export function AgentPromptEditor() {
  const { t } = useTranslation('agentV2')
  const readOnly = useAgentOrchestrateReadOnly()
  const [value, setValue] = useAtom(agentComposerPromptAtom)
  const { skills } = useAgentConfigSkills()
  const { files } = useAgentConfigFiles()
  const [tools, setTools] = useAtom(agentComposerToolsAtom)
  const { getConfiguredToolIcon } = useAgentPromptToolIconResolver()
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
  const { copied, copy } = useClipboard({
    timeout: 2000,
    onCopyError: () => {
      toast.error(t('agentDetail.configure.prompt.copyFailed'))
    },
  })
  const [slashMenuView, setSlashMenuView] = useState<SlashMenuView>('main')
  const [isSlashMenuOpen, setIsSlashMenuOpen] = useState(false)
  const [slashMenuPosition, setSlashMenuPosition] = useState<SlashMenuPosition | null>(null)
  const [selectionRestoreRequest, setSelectionRestoreRequest] = useState<SelectionRestoreRequest | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const slashInsertRangeRef = useRef<TextRange | null>(null)
  const selectionRestoreRequestIdRef = useRef(0)
  const configuredReferenceIds = useMemo(() => {
    const skillIds = new Set<string>()
    skills.forEach((skill) => {
      skillIds.add(skill.id)
      skillIds.add(encodeURIComponent(skill.id))
      if (skill.skillMdKey) {
        skillIds.add(skill.skillMdKey)
        skillIds.add(encodeURIComponent(skill.skillMdKey))
      }
    })

    const fileIds = new Set<string>()
    flattenFileNodes(files).forEach((file) => {
      fileIds.add(file.id)
      fileIds.add(encodeURIComponent(file.id))
      if (file.driveKey) {
        fileIds.add(file.driveKey)
        fileIds.add(encodeURIComponent(file.driveKey))
      }
    })

    return {
      skills: skillIds,
      files: fileIds,
      knowledge: new Set(retrievals.map(retrieval => retrieval.id)),
      cliTools: new Set(tools.flatMap(tool => tool.kind === 'cli' ? [tool.id] : [])),
    }
  }, [files, retrievals, skills, tools])

  const handleCopyPrompt = useCallback(() => {
    void copy(value)
  }, [copy, value])

  const closeSlashMenu = () => {
    setIsSlashMenuOpen(false)
    setSlashMenuPosition(null)
    setSlashMenuView('main')
  }

  const updateSlashMenuPosition = useCallback(() => {
    const editorElement = editorRef.current
    if (!editorElement)
      return

    const position = getSlashMenuPosition(editorElement)
    if (!position)
      return

    setSlashMenuPosition(position)
  }, [])

  const openSlashMenu = useCallback(() => {
    setSlashMenuView('main')
    updateSlashMenuPosition()
    setIsSlashMenuOpen(true)
  }, [updateSlashMenuPosition])

  const syncSlashMenuWithSelection = useCallback(() => {
    if (!isHydrated || readOnly)
      return

    if (isSelectionAfterSlash(editorRef.current, value)) {
      updateSlashMenuPosition()
      openSlashMenu()
    }
    else {
      slashInsertRangeRef.current = null
      closeSlashMenu()
    }
  }, [isHydrated, openSlashMenu, readOnly, updateSlashMenuPosition, value])

  const handleSlashRangeChange = useCallback((range: TextRange | null) => {
    if (range)
      slashInsertRangeRef.current = range
  }, [])

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
    const slashRange = slashInsertRangeRef.current
    let insertionResult
    if (slashRange) {
      insertionResult = insertTokenAtTextRange(value, slashRange, token)
    }
    else {
      const nextValue = replaceTrailingSlashWithToken(value, token)
      insertionResult = {
        value: nextValue,
        cursorOffset: nextValue.length,
      }
    }
    setValue(insertionResult.value)
    slashInsertRangeRef.current = null
    selectionRestoreRequestIdRef.current += 1
    setSelectionRestoreRequest({
      id: selectionRestoreRequestIdRef.current,
      offset: insertionResult.cursorOffset,
    })
    closeSlashMenu()
  }

  const handleInsertSlash = () => {
    setValue(`${value}/`)
    openSlashMenu()
  }

  const renderRosterReferenceIcon = useCallback((token: RosterReferenceToken) => {
    if (!ENABLE_AGENT_CLI_TOOLS && token.kind === 'cli_tool')
      return null

    if (token.kind !== 'tool' && token.kind !== 'tool-all' && token.kind !== 'cli_tool')
      return null

    if ((token.kind === 'tool' || token.kind === 'tool-all') && !getProviderToolFromToken(token, tools))
      return null

    return (
      <AgentPromptRosterReferenceIcon
        token={token}
        tools={tools}
        getConfiguredToolIcon={getConfiguredToolIcon}
      />
    )
  }, [getConfiguredToolIcon, tools])

  const getRosterReferenceWarning = useCallback((token: RosterReferenceToken) => {
    const warning = t('agentDetail.configure.prompt.referenceMissing', { name: token.label })

    if (token.kind === 'skill')
      return configuredReferenceIds.skills.has(token.id) ? undefined : warning

    if (token.kind === 'file')
      return configuredReferenceIds.files.has(token.id) ? undefined : warning

    if (token.kind === 'knowledge')
      return configuredReferenceIds.knowledge.has(token.id) ? undefined : warning

    if (token.kind === 'cli_tool')
      return ENABLE_AGENT_CLI_TOOLS && configuredReferenceIds.cliTools.has(token.id) ? undefined : warning

    if (token.kind === 'tool' || token.kind === 'tool-all')
      return getProviderToolFromToken(token, tools) ? undefined : warning
  }, [configuredReferenceIds, t, tools])

  useEffect(() => {
    if (!isSlashMenuOpen)
      return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node))
        return

      if (
        target instanceof Element
        && target.closest('[data-agent-prompt-slash-menu]')
      ) {
        return
      }

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
  const slashMenuWidth = slashMenuView === 'main' ? slashMenuMainWidth : slashMenuSubmenuWidth
  const slashMenu = isHydrated && !readOnly && isSlashMenuOpen
    ? createPortal(
        <div
          data-agent-prompt-slash-menu
          className="fixed z-60"
          style={{
            left: slashMenuPosition ? `${getSlashMenuLeft(slashMenuPosition, slashMenuWidth)}px` : '12px',
            top: slashMenuPosition ? `${slashMenuPosition.top}px` : '36px',
          }}
        >
          <AgentPromptSlashMenu
            view={slashMenuView}
            categories={slashMenuCategories}
            skills={skills}
            files={files}
            tools={tools}
            onToolsChange={setTools}
            onAddCliTool={ENABLE_AGENT_CLI_TOOLS ? addActions.cli : undefined}
            onAddFile={addActions.files}
            onAddKnowledge={addActions.knowledge}
            onAddSkill={addActions.skills}
            retrievals={retrievals}
            onBack={() => setSlashMenuView('main')}
            onOpenCategory={setSlashMenuView}
            onSelect={handleSlashSelect}
          />
        </div>,
        document.body,
      )
    : null

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
            <AgentConfigureTipContent type="prompt" />
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
          <div ref={editorRef} className="min-h-[104px] overflow-y-auto px-3 pt-0.5">
            <PromptEditor
              instanceId="agent-configure-prompt-editor"
              aria-labelledby="agent-configure-prompt-label"
              compact
              wrapperClassName="min-h-[104px]"
              className="min-h-[104px] text-text-primary"
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
                getWarning: getRosterReferenceWarning,
              }}
              disableSlashPicker
              disableBracePicker
            >
              <AgentPromptSelectionBridge
                restoreRequest={selectionRestoreRequest}
                onSlashRangeChange={handleSlashRangeChange}
              />
            </PromptEditor>
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

        {slashMenu}
      </div>
    </section>
  )
}
