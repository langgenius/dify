'use client'

import type { LexicalNode } from 'lexical'
import type { MouseEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
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
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
} from 'lexical'
import { useCallback, useEffect, useMemo, useLayoutEffect as useReactLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import PromptEditor from '@/app/components/base/prompt-editor'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import { agentComposerKnowledgeRetrievalsAtom } from '@/features/agent-v2/agent-composer/store-modules/knowledge'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import {
  addProviderToolsAtom,
  agentComposerToolsAtom,
} from '@/features/agent-v2/agent-composer/store-modules/tools'
import { ENABLE_AGENT_CLI_TOOLS } from '@/features/agent-v2/agent-detail/configure/feature-flags'
import { useAgentOrchestrateAddActions } from '../add-actions-context'
import { AgentConfigureTipContent } from '../common/tip-content'
import { useAgentConfigFiles, useAgentConfigSkills } from '../config-context'
import { useAgentOrchestrateReadOnly } from '../read-only-context'
import { useAgentPromptToolIconResolver } from './hooks'
import { insertTokenAtTextRange, replaceTrailingSlashWithToken } from './options'
import { AgentPromptSlashMenu } from './slash'

const noopLayoutEffect: typeof useReactLayoutEffect = () => {}
const useIsoLayoutEffect = typeof document !== 'undefined'
  ? useReactLayoutEffect
  : noopLayoutEffect

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
  const ownerDocument = node.ownerDocument ?? document
  const walker = ownerDocument.createTreeWalker(node, ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? NodeFilter.SHOW_TEXT)
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

  const selection = rootElement.ownerDocument.getSelection()
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

/* v8 ignore start -- Lexical selection offsets and DOM range geometry are browser-editor integration glue; user-visible slash insertion behavior is covered by AgentPromptEditor tests. @preserve */
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
  containerWidth: number
}

const slashMenuViewportPadding = 8
const slashMenuMainWidth = 200
const slashMenuSubmenuWidth = 360
const agentPromptSlashMenuId = 'agent-configure-prompt-slash-menu'

const getRangeRect = (range: Range) => {
  const rects = range.getClientRects()
  if (rects.length)
    return rects[rects.length - 1]!

  return range.getBoundingClientRect()
}

const getLastTextNode = (node: Node): Text | null => {
  if (node.nodeType === Node.TEXT_NODE)
    return node as Text

  for (let index = node.childNodes.length - 1; index >= 0; index--) {
    const textNode = getLastTextNode(node.childNodes.item(index))
    if (textNode)
      return textNode
  }

  return null
}

const getSlashAnchorRange = (selection: Selection, editorElement: HTMLElement) => {
  const anchorNode = selection.anchorNode
  if (!anchorNode || !editorElement.contains(anchorNode))
    return null

  const ownerDocument = editorElement.ownerDocument

  if (anchorNode.nodeType === Node.TEXT_NODE) {
    const text = anchorNode.textContent ?? ''
    if (selection.anchorOffset > 0 && text[selection.anchorOffset - 1] === '/') {
      const range = ownerDocument.createRange()
      range.setStart(anchorNode, selection.anchorOffset - 1)
      range.setEnd(anchorNode, selection.anchorOffset)
      return range
    }
  }

  if (anchorNode.nodeType !== Node.ELEMENT_NODE)
    return null

  const previousChild = anchorNode.childNodes.item(selection.anchorOffset - 1)
  if (!previousChild)
    return null

  const textNode = getLastTextNode(previousChild)
  const text = textNode?.textContent ?? ''
  if (!textNode || !text.endsWith('/'))
    return null

  const range = ownerDocument.createRange()
  range.setStart(textNode, text.length - 1)
  range.setEnd(textNode, text.length)
  return range
}

const getSlashMenuPosition = (rootElement: HTMLElement, editorElement: HTMLElement): SlashMenuPosition | null => {
  const selection = editorElement.ownerDocument.getSelection()
  if (!selection || !selection.isCollapsed || selection.rangeCount === 0)
    return null

  const anchorNode = selection.anchorNode
  if (!anchorNode || !editorElement.contains(anchorNode))
    return null

  const slashRange = getSlashAnchorRange(selection, editorElement)
  const caretRange = selection.getRangeAt(0).cloneRange()
  const rect = slashRange ? getRangeRect(slashRange) : getRangeRect(caretRange)

  if (!rect || (rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0)) {
    const editorRect = editorElement.getBoundingClientRect()
    const rootRect = rootElement.getBoundingClientRect()

    return {
      left: editorRect.left - rootRect.left + slashMenuViewportPadding,
      top: editorRect.top - rootRect.top + 24,
      containerWidth: rootRect.width,
    }
  }

  const editorRect = editorElement.getBoundingClientRect()
  if (!rect || rect.bottom < editorRect.top || rect.top > editorRect.bottom)
    return null

  const rootRect = rootElement.getBoundingClientRect()

  return {
    left: rect.right - rootRect.left,
    top: rect.bottom - rootRect.top + 4,
    containerWidth: rootRect.width,
  }
}

const getSlashMenuLeft = (position: SlashMenuPosition, width: number) => {
  const maxLeft = Math.max(
    slashMenuViewportPadding,
    position.containerWidth - width - slashMenuViewportPadding,
  )

  return Math.max(
    slashMenuViewportPadding,
    Math.min(position.left, maxLeft),
  )
}
/* v8 ignore stop */

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
  const tools = useAtomValue(agentComposerToolsAtom)
  const addProviderTools = useSetAtom(addProviderToolsAtom)
  const { getConfiguredToolIcon } = useAgentPromptToolIconResolver()
  const retrievals = useAtomValue(agentComposerKnowledgeRetrievalsAtom)
  const addActions = useAgentOrchestrateAddActions()
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
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const slashMenuAnnouncementRef = useRef<HTMLSpanElement>(null)
  const slashInsertRangeRef = useRef<TextRange | null>(null)
  const slashMenuShouldAutoFocusRef = useRef(false)
  const slashMenuKeepsEditorFocusRef = useRef(false)
  const slashMenuActiveIndexRef = useRef(-1)
  const slashMenuParentActiveIndexRef = useRef(-1)
  const slashMenuHandledKeyboardEventRef = useRef(false)
  const slashMenuSyncFrameRef = useRef<number | null>(null)
  const slashMenuSyncWindowRef = useRef<Window | null>(null)
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

  const closeSlashMenu = useCallback(() => {
    setIsSlashMenuOpen(false)
    setSlashMenuPosition(null)
    if (slashMenuAnnouncementRef.current)
      slashMenuAnnouncementRef.current.textContent = ''
    setSlashMenuView('main')
    slashMenuShouldAutoFocusRef.current = false
    slashMenuKeepsEditorFocusRef.current = false
    slashMenuActiveIndexRef.current = -1
    slashMenuParentActiveIndexRef.current = -1
    slashMenuHandledKeyboardEventRef.current = false
  }, [])

  const updateSlashMenuPosition = useCallback(() => {
    const rootElement = rootRef.current
    const editorElement = editorRef.current
    if (!rootElement || !editorElement)
      return

    const position = getSlashMenuPosition(rootElement, editorElement)
    if (!position)
      return

    setSlashMenuPosition(position)
  }, [])

  const openSlashMenu = useCallback((options: { autoFocus: boolean }) => {
    slashMenuShouldAutoFocusRef.current = options.autoFocus
    slashMenuKeepsEditorFocusRef.current = !options.autoFocus
    slashMenuActiveIndexRef.current = options.autoFocus ? 0 : -1
    slashMenuParentActiveIndexRef.current = -1
    if (slashMenuAnnouncementRef.current)
      slashMenuAnnouncementRef.current.textContent = ''
    setSlashMenuView('main')
    updateSlashMenuPosition()
    setIsSlashMenuOpen(true)
  }, [updateSlashMenuPosition])

  const syncSlashMenuWithSelection = useCallback(() => {
    if (readOnly)
      return

    if (isSelectionAfterSlash(editorRef.current, value)) {
      updateSlashMenuPosition()
      openSlashMenu({ autoFocus: false })
    }
    else {
      slashInsertRangeRef.current = null
      closeSlashMenu()
    }
  }, [closeSlashMenu, openSlashMenu, readOnly, updateSlashMenuPosition, value])

  const scheduleSlashMenuSync = useCallback(() => {
    const ownerWindow = editorRef.current?.ownerDocument.defaultView ?? window
    if (slashMenuSyncFrameRef.current !== null)
      (slashMenuSyncWindowRef.current ?? ownerWindow).cancelAnimationFrame(slashMenuSyncFrameRef.current)

    slashMenuSyncWindowRef.current = ownerWindow
    slashMenuSyncFrameRef.current = ownerWindow.requestAnimationFrame(() => {
      slashMenuSyncFrameRef.current = null
      slashMenuSyncWindowRef.current = null
      syncSlashMenuWithSelection()
    })
  }, [syncSlashMenuWithSelection])

  useEffect(() => {
    return () => {
      if (slashMenuSyncFrameRef.current !== null)
        (slashMenuSyncWindowRef.current ?? window).cancelAnimationFrame(slashMenuSyncFrameRef.current)
    }
  }, [])

  const handleSlashRangeChange = useCallback((range: TextRange | null) => {
    if (range)
      slashInsertRangeRef.current = range
  }, [])

  const focusPromptEditor = useCallback(() => {
    const editable = editorRef.current?.querySelector<HTMLElement>('[contenteditable="true"], [role="textbox"]')
    editable?.focus({ preventScroll: true })
  }, [])

  const getSlashMenuItems = useCallback(() => Array.from(slashMenuRef.current?.querySelectorAll<HTMLElement>('[data-agent-prompt-menu-item]') ?? [])
    .filter(item => !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true'), [])

  const setActiveSlashMenuItem = useCallback((menuItems: HTMLElement[], index: number) => {
    slashMenuActiveIndexRef.current = index
    menuItems.forEach((item, itemIndex) => {
      item.toggleAttribute('data-agent-prompt-menu-active', itemIndex === index)
    })
    const announcement = index >= 0
      ? menuItems[index]?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      : ''
    if (slashMenuAnnouncementRef.current && slashMenuAnnouncementRef.current.textContent !== announcement)
      slashMenuAnnouncementRef.current.textContent = announcement
  }, [])

  const activateSlashMenuItem = useCallback((item: HTMLElement | undefined) => {
    if (!item)
      return

    if (item.hasAttribute('data-agent-prompt-menu-category')) {
      const itemIndex = getSlashMenuItems().indexOf(item)
      slashMenuParentActiveIndexRef.current = itemIndex >= 0
        ? itemIndex
        : Math.max(0, slashMenuActiveIndexRef.current)
      slashMenuActiveIndexRef.current = 0
    }

    item.click()
  }, [getSlashMenuItems])

  const returnToSlashMenuMain = useCallback(() => {
    slashMenuActiveIndexRef.current = Math.max(0, slashMenuParentActiveIndexRef.current)
    setSlashMenuView('main')
  }, [])

  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    slashMenuHandledKeyboardEventRef.current = false

    if (readOnly)
      return

    if (event.key === 'Escape' && isSlashMenuOpen) {
      event.preventDefault()
      slashMenuHandledKeyboardEventRef.current = true
      closeSlashMenu()
      return
    }

    if (!isSlashMenuOpen)
      return

    const menuItems = getSlashMenuItems()
    if (!menuItems.length)
      return

    if (event.key === 'ArrowLeft' && slashMenuView !== 'main') {
      event.preventDefault()
      event.stopPropagation()
      slashMenuHandledKeyboardEventRef.current = true
      returnToSlashMenuMain()
      return
    }

    if (event.key === 'ArrowRight' && slashMenuActiveIndexRef.current >= 0) {
      const activeItem = menuItems[slashMenuActiveIndexRef.current]
      if (!activeItem?.hasAttribute('data-agent-prompt-menu-category') && !activeItem?.hasAttribute('aria-expanded'))
        return

      event.preventDefault()
      event.stopPropagation()
      slashMenuHandledKeyboardEventRef.current = true
      activateSlashMenuItem(activeItem)
      return
    }

    if ((event.key === 'Enter' || event.key === ' ') && slashMenuActiveIndexRef.current >= 0) {
      const activeItem = menuItems[slashMenuActiveIndexRef.current]
      event.preventDefault()
      event.stopPropagation()
      slashMenuHandledKeyboardEventRef.current = true
      activateSlashMenuItem(activeItem)
      return
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End')
      return

    event.preventDefault()
    event.stopPropagation()
    slashMenuHandledKeyboardEventRef.current = true

    if (event.key === 'Home') {
      setActiveSlashMenuItem(menuItems, 0)
      return
    }

    if (event.key === 'End') {
      setActiveSlashMenuItem(menuItems, menuItems.length - 1)
      return
    }

    const activeIndex = slashMenuActiveIndexRef.current
    const nextIndex = activeIndex === -1
      ? event.key === 'ArrowUp' ? menuItems.length - 1 : 0
      : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + menuItems.length) % menuItems.length

    setActiveSlashMenuItem(menuItems, nextIndex)
  }

  const handleEditorKeyUp = () => {
    if (slashMenuHandledKeyboardEventRef.current) {
      slashMenuHandledKeyboardEventRef.current = false
      return
    }

    scheduleSlashMenuSync()
  }

  const handleEditorPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target
    if (
      target instanceof Element
      && target.closest('[data-agent-prompt-toolbar]')
    ) {
      return
    }

    scheduleSlashMenuSync()
  }

  const handleSlashMenuPointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (slashMenuKeepsEditorFocusRef.current)
      event.preventDefault()
  }

  const handleSlashMenuMouseDownCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (slashMenuKeepsEditorFocusRef.current)
      event.preventDefault()
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
    openSlashMenu({ autoFocus: true })
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

    const rootElement = rootRef.current
    if (!rootElement)
      return
    const ownerDocument = rootElement.ownerDocument

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

      if (!rootElement.contains(target))
        closeSlashMenu()
    }

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (target instanceof Node && !rootElement.contains(target))
        closeSlashMenu()
    }

    ownerDocument.addEventListener('pointerdown', handlePointerDown)
    ownerDocument.addEventListener('focusin', handleFocusIn)
    return () => {
      ownerDocument.removeEventListener('pointerdown', handlePointerDown)
      ownerDocument.removeEventListener('focusin', handleFocusIn)
    }
  }, [closeSlashMenu, isSlashMenuOpen])

  useIsoLayoutEffect(() => {
    if (!isSlashMenuOpen)
      return

    const menuElement = slashMenuRef.current
    if (!menuElement)
      return

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const activeElement = menuElement.ownerDocument.activeElement
      if (!menuElement.contains(activeElement))
        return

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeSlashMenu()
        focusPromptEditor()
        return
      }

      if (event.key === 'ArrowLeft' && slashMenuView !== 'main') {
        event.preventDefault()
        event.stopPropagation()
        returnToSlashMenuMain()
        return
      }

      const menuItems = getSlashMenuItems()
      if (!menuItems.length)
        return

      const currentIndex = menuItems.findIndex(item => item === activeElement)

      if (event.key === 'ArrowRight') {
        const currentItem = menuItems[currentIndex]
        if (currentItem?.hasAttribute('data-agent-prompt-menu-category') || currentItem?.hasAttribute('aria-expanded')) {
          event.preventDefault()
          event.stopPropagation()
          activateSlashMenuItem(currentItem)
        }

        return
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End')
        return

      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Home') {
        setActiveSlashMenuItem(menuItems, 0)
        menuItems[0]?.focus()
        return
      }

      if (event.key === 'End') {
        setActiveSlashMenuItem(menuItems, menuItems.length - 1)
        menuItems[menuItems.length - 1]?.focus()
        return
      }

      const direction = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex = currentIndex === -1
        ? direction === 1 ? 0 : menuItems.length - 1
        : (currentIndex + direction + menuItems.length) % menuItems.length

      setActiveSlashMenuItem(menuItems, nextIndex)
      menuItems[nextIndex]?.focus()
    }

    menuElement.addEventListener('keydown', handleKeyDown)
    return () => {
      menuElement.removeEventListener('keydown', handleKeyDown)
    }
  }, [activateSlashMenuItem, closeSlashMenu, focusPromptEditor, getSlashMenuItems, isSlashMenuOpen, returnToSlashMenuMain, setActiveSlashMenuItem, slashMenuView])

  useIsoLayoutEffect(() => {
    if (!isSlashMenuOpen)
      return

    const menuItems = getSlashMenuItems()
    if (!menuItems.length)
      return

    if (slashMenuKeepsEditorFocusRef.current) {
      const activeIndex = slashMenuActiveIndexRef.current < 0
        ? -1
        : Math.min(slashMenuActiveIndexRef.current, menuItems.length - 1)
      setActiveSlashMenuItem(menuItems, activeIndex)
      return
    }

    if (!slashMenuShouldAutoFocusRef.current && slashMenuView === 'main')
      return

    slashMenuShouldAutoFocusRef.current = true
    const activeIndex = slashMenuActiveIndexRef.current < 0
      ? 0
      : Math.min(slashMenuActiveIndexRef.current, menuItems.length - 1)
    setActiveSlashMenuItem(menuItems, activeIndex)
    menuItems[activeIndex]?.focus({ preventScroll: true })
  }, [getSlashMenuItems, isSlashMenuOpen, setActiveSlashMenuItem, slashMenuView])

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
  const handleOpenSlashMenuCategory = (view: Exclude<SlashMenuView, 'main'>) => {
    slashMenuParentActiveIndexRef.current = Math.max(
      0,
      slashMenuCategories.findIndex(category => category.key === view),
    )
    slashMenuActiveIndexRef.current = 0
    setSlashMenuView(view)
  }
  const slashMenuWidth = slashMenuView === 'main' ? slashMenuMainWidth : slashMenuSubmenuWidth
  const slashMenu = !readOnly && isSlashMenuOpen
    ? (
        <div
          id={agentPromptSlashMenuId}
          ref={slashMenuRef}
          data-agent-prompt-slash-menu
          role="dialog"
          aria-label={t('agentDetail.configure.prompt.insert.label')}
          tabIndex={-1}
          className="absolute z-30"
          onPointerDownCapture={handleSlashMenuPointerDownCapture}
          onMouseDownCapture={handleSlashMenuMouseDownCapture}
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
            onAddProviderTools={addProviderTools}
            onAddCliTool={ENABLE_AGENT_CLI_TOOLS ? addActions.cli : undefined}
            onAddFile={addActions.files}
            onAddKnowledge={addActions.knowledge}
            onAddSkill={addActions.skills}
            retrievals={retrievals}
            onBack={returnToSlashMenuMain}
            onOpenCategory={handleOpenSlashMenuCategory}
            onSelect={handleSlashSelect}
          />
        </div>
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
              aria-controls={isSlashMenuOpen ? agentPromptSlashMenuId : undefined}
              aria-haspopup="dialog"
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
            <span ref={slashMenuAnnouncementRef} className="sr-only" aria-live="polite" />
          </div>
          {!readOnly && (
            <div
              data-agent-prompt-toolbar
              className="flex h-8 shrink-0 items-center justify-between px-3 text-text-tertiary opacity-0 transition-opacity group-focus-within:opacity-100"
            >
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={isSlashMenuOpen}
                  aria-controls={isSlashMenuOpen ? agentPromptSlashMenuId : undefined}
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
