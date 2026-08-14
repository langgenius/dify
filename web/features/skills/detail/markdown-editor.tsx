'use client'

import type {
  SkillFileResponse,
  SkillVersionResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type {
  ChangeEvent,
  ComponentPropsWithoutRef,
  CSSProperties,
  FocusEventHandler,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  RefObject,
} from 'react'
import type { MarkdownProps } from '@/app/components/base/markdown'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Textarea from 'react-textarea-autosize'
import { visit } from 'unist-util-visit'
import { Markdown } from '@/app/components/base/markdown'
import useTimestamp from '@/hooks/use-timestamp'
import styles from './markdown-editor.module.css'
import {
  getMarkdownLiveEditorSelectionOffset,
  getPathBaseName,
  getReferenceDisplayLabel,
  getReferenceIconClass,
  getSkillFileIconClass,
  getSkillVersionTitle,
  isDirectory,
  renderMarkdownLiveEditorContent,
  serializeMarkdownLiveEditorNode,
  setMarkdownLiveEditorSelectionOffset,
} from './shared'

type SkillMarkdownLinkProps = ComponentPropsWithoutRef<'a'> & { node?: unknown }

const SKILL_REFERENCE_URL_PREFIX = 'https://dify.local/__skill_reference__/'

function getMarkdownReferencePath(href: string | undefined) {
  if (href?.startsWith(SKILL_REFERENCE_URL_PREFIX)) {
    try {
      return decodeURIComponent(href.slice(SKILL_REFERENCE_URL_PREFIX.length))
    } catch {
      return href.slice(SKILL_REFERENCE_URL_PREFIX.length)
    }
  }

  if (!href || href.startsWith('#') || href.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(href))
    return

  try {
    return decodeURIComponent(href)
  } catch {
    return href
  }
}

function encodeSkillMarkdownReferenceLinks() {
  return (tree: Parameters<typeof visit>[0]) => {
    visit(tree, 'link', (node) => {
      const linkNode = node as { url?: string }
      const referencePath = getMarkdownReferencePath(linkNode.url)
      if (!referencePath) return

      linkNode.url = `${SKILL_REFERENCE_URL_PREFIX}${encodeURIComponent(referencePath)}`
    })
  }
}

const SKILL_REFERENCE_REMARK_PLUGINS = [encodeSkillMarkdownReferenceLinks]

const markdownPreviewBlockSelector = 'h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, td, th'

function findClosestTextOffset(content: string, text: string, preferredOffset: number) {
  let closestOffset = -1
  let searchOffset = content.indexOf(text)

  while (searchOffset !== -1) {
    if (
      closestOffset === -1 ||
      Math.abs(searchOffset - preferredOffset) < Math.abs(closestOffset - preferredOffset)
    ) {
      closestOffset = searchOffset
    }
    searchOffset = content.indexOf(text, searchOffset + 1)
  }

  return closestOffset
}

function getMarkdownPreviewSelectionOffset(
  root: HTMLElement,
  target: EventTarget | null,
  body: string,
  clientX?: number,
  clientY?: number,
) {
  const rootRect = root.getBoundingClientRect()
  const clickRatio =
    clientY == null || rootRect.height === 0
      ? 0
      : Math.min(Math.max((clientY - rootRect.top) / rootRect.height, 0), 1)
  const preferredOffset = Math.round(body.length * clickRatio)
  const targetElement = target instanceof HTMLElement ? target : null
  const blockElement = targetElement?.closest<HTMLElement>(markdownPreviewBlockSelector)
  const blockText = blockElement?.textContent?.trim()

  if (clientX != null && clientY != null) {
    const documentWithCaretPosition = root.ownerDocument as Document & {
      caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null
    }
    const caretPosition = documentWithCaretPosition.caretPositionFromPoint?.(clientX, clientY)
    const caretText = caretPosition?.offsetNode.textContent
    if (caretPosition && caretText?.trim()) {
      const caretTextOffset = findClosestTextOffset(body, caretText, preferredOffset)
      if (caretTextOffset !== -1) return caretTextOffset + caretPosition.offset
    }
  }

  if (blockText) {
    const blockOffset = findClosestTextOffset(body, blockText, preferredOffset)
    if (blockOffset !== -1) return blockOffset
  }

  const approximateOffset = Math.round(body.length * clickRatio)
  return body.lastIndexOf('\n', approximateOffset) + 1
}

function getScrollParent(element: HTMLElement) {
  let parent = element.parentElement

  while (parent) {
    const overflowY = parent.ownerDocument.defaultView?.getComputedStyle(parent).overflowY
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      parent.scrollHeight > parent.clientHeight
    )
      return parent
    parent = parent.parentElement
  }
}

function getSelectionRect(root: HTMLElement) {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return

  const range = selection.getRangeAt(0).cloneRange()
  if (!root.contains(range.startContainer)) return
  range.collapse(true)
  return range.getBoundingClientRect()
}

function getLineBoxTop(rect: DOMRect, rootRect: DOMRect, lineHeight: number) {
  const leadingInset = Number.isFinite(lineHeight) ? Math.max((lineHeight - rect.height) / 2, 0) : 0

  return Math.max(rect.top - rootRect.top - leadingInset, 0)
}

function getSelectionLinePosition(root: HTMLElement) {
  const selection = root.ownerDocument.getSelection()
  if (!selection?.isCollapsed || selection.rangeCount === 0) return

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return

  const rootRect = root.getBoundingClientRect()
  const lineHeight = Number.parseFloat(
    root.ownerDocument.defaultView?.getComputedStyle(root).lineHeight ?? '',
  )
  let selectionRect = getSelectionRect(root)

  if (!selectionRect?.height && range.startContainer !== root) {
    const selectionNode = range.startContainer
    let lineElement =
      selectionNode instanceof HTMLElement ? selectionNode : selectionNode?.parentElement

    while (lineElement?.parentElement && lineElement.parentElement !== root)
      lineElement = lineElement.parentElement

    if (lineElement?.parentElement === root) selectionRect = lineElement.getBoundingClientRect()
  }

  if (!selectionRect?.height) {
    const prefixRange = range.cloneRange()
    prefixRange.selectNodeContents(root)
    prefixRange.setEnd(range.startContainer, range.startOffset)
    const prefixRects = Array.from(prefixRange.getClientRects())
    const lastPrefixRect = prefixRects.at(-1)

    if (lastPrefixRect && Number.isFinite(lineHeight)) {
      // Chrome emits zero-width rects for trailing newlines. Anchor to the last painted
      // content rect, then advance by the serialized line breaks so none are counted twice.
      let lastContentRect: DOMRect | undefined
      for (let index = prefixRects.length - 1; index >= 0; index--) {
        const rect = prefixRects[index]
        if (!rect?.width) continue

        lastContentRect = rect
        break
      }
      const prefix = serializeMarkdownLiveEditorNode(prefixRange.cloneContents()).replace(
        /\u00A0/g,
        ' ',
      )
      const trailingLineBreaks = prefix.match(/\n+$/)?.[0].length ?? 0
      const anchorRect = lastContentRect ?? lastPrefixRect
      const remainingLineBreaks = lastContentRect
        ? trailingLineBreaks
        : Math.min(trailingLineBreaks, 1)
      return {
        left: trailingLineBreaks > 0 ? 0 : Math.max(lastPrefixRect.right - rootRect.left, 0),
        top: getLineBoxTop(anchorRect, rootRect, lineHeight) + remainingLineBreaks * lineHeight,
      }
    }

    return
  }

  return {
    left: Math.max(selectionRect.left - rootRect.left, 0),
    top: getLineBoxTop(selectionRect, rootRect, lineHeight),
  }
}

function getSelectionLineBlank(root: HTMLElement) {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return
  if (!selection.isCollapsed) return false

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return

  let lineElement =
    range.startContainer instanceof HTMLElement
      ? range.startContainer
      : range.startContainer.parentElement
  while (lineElement?.parentElement && lineElement.parentElement !== root)
    lineElement = lineElement.parentElement

  if (
    lineElement?.parentElement === root &&
    (lineElement.tagName === 'DIV' || lineElement.tagName === 'P')
  ) {
    return !serializeMarkdownLiveEditorNode(lineElement).trim()
  }

  const value = serializeMarkdownLiveEditorNode(root).replace(/\u00A0/g, ' ')
  const offset = getMarkdownLiveEditorSelectionOffset(root)
  if (offset == null) return

  return getCurrentLine(value, offset).blank
}

function getMarkdownPreviewAnchorRect(root: HTMLElement, body: string, sourceOffset: number) {
  let closestElement: HTMLElement | undefined
  let closestDistance = Number.POSITIVE_INFINITY

  for (const element of root.querySelectorAll<HTMLElement>(markdownPreviewBlockSelector)) {
    const text = element.textContent?.trim()
    if (!text) continue

    const textOffset = findClosestTextOffset(body, text, sourceOffset)
    if (textOffset === -1) continue

    const distance =
      sourceOffset < textOffset
        ? textOffset - sourceOffset
        : Math.max(sourceOffset - (textOffset + text.length), 0)
    if (distance >= closestDistance) continue

    closestDistance = distance
    closestElement = element
  }

  return closestElement?.getBoundingClientRect()
}

function useSkillMarkdownComponents(onOpenReference?: (path: string) => void) {
  return useMemo<NonNullable<MarkdownProps['customComponents']>>(
    () => ({
      a: ({ children, href }: SkillMarkdownLinkProps) => {
        const referencePath = getMarkdownReferencePath(href)
        if (!referencePath) {
          return (
            <a
              href={href}
              target={href?.startsWith('#') ? undefined : '_blank'}
              rel={href?.startsWith('#') ? undefined : 'noopener noreferrer'}
              className="cursor-pointer underline decoration-primary-700! decoration-dashed"
            >
              {children}
            </a>
          )
        }

        const referenceLabel =
          typeof children === 'string' || typeof children === 'number'
            ? String(children)
            : getPathBaseName(referencePath)

        return (
          <button
            type="button"
            data-reference-path={referencePath}
            title={referencePath}
            className="inline-flex cursor-pointer flex-col items-start px-0.5 py-px align-baseline outline-hidden focus-visible:rounded-[5px] focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => onOpenReference?.(referencePath)}
          >
            <span className="inline-flex min-w-[18px] items-center overflow-hidden rounded-[5px] border border-state-accent-hover-alt bg-state-accent-hover py-px pr-1 pl-px text-text-accent shadow-xs">
              <span className="inline-flex min-w-0 items-center gap-0.5">
                <span className="inline-flex shrink-0 items-center justify-center p-px">
                  <span
                    aria-hidden
                    className={cn('size-3.5 shrink-0', getReferenceIconClass(referencePath))}
                  />
                </span>
                <span className="max-w-48 truncate system-xs-medium">
                  {getReferenceDisplayLabel(referencePath, referenceLabel)}
                </span>
              </span>
            </span>
          </button>
        )
      },
    }),
    [onOpenReference],
  )
}

function EditorPlaceholder({
  className,
  style,
  text,
}: {
  className?: string
  style?: CSSProperties
  text: string
}) {
  const shortcutIndex = text.indexOf('/')
  const beforeShortcut = shortcutIndex >= 0 ? text.slice(0, shortcutIndex) : text
  const afterShortcut = shortcutIndex >= 0 ? text.slice(shortcutIndex + 1) : ''
  const referenceMatch = afterShortcut.match(/^(.*?)(reference files|引用文件)\s*$/i)
  const afterTo = referenceMatch?.[1] ?? afterShortcut
  const referenceFiles = referenceMatch?.[2] ?? ''

  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        'pointer-events-none inline-flex items-center gap-1 text-[15px]/6 tracking-[-0.075px] whitespace-nowrap text-text-quaternary',
        className,
      )}
    >
      <span>{beforeShortcut}</span>
      <kbd className="inline-flex min-w-4 items-center justify-center rounded bg-components-kbd-bg-gray px-0.5 system-xs-medium text-text-quaternary">
        /
      </kbd>
      <span>{afterTo}</span>
      {referenceFiles && (
        <span className="border-b border-dotted border-text-quaternary system-xs-regular">
          {referenceFiles}
        </span>
      )}
    </span>
  )
}

function getCurrentLine(value: string, offset: number) {
  const lineIndex = value.slice(0, offset).split('\n').length - 1
  const lines = value.split('\n')

  return {
    blank: !(lines[lineIndex] ?? '').trim(),
    lineIndex,
  }
}

export function MarkdownModeSwitch({
  mode,
  onChange,
}: {
  mode: 'live' | 'source'
  onChange: (mode: 'live' | 'source') => void
}) {
  const { t } = useTranslation('skill')

  return (
    <div className="absolute top-3 right-2 z-10 flex h-8 items-center rounded-md bg-components-segmented-control-bg-normal p-0.5">
      <button
        type="button"
        aria-label={t(($) => $['skillManagement.detail.markdownLiveMode'])}
        title={t(($) => $['skillManagement.detail.markdownLiveMode'])}
        className={cn(
          'flex size-7 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          mode === 'live' &&
            'border-[0.5px] border-components-segmented-control-item-active-border bg-components-segmented-control-item-active-bg text-text-primary shadow-xs',
        )}
        onClick={() => onChange('live')}
      >
        <span aria-hidden className="i-ri-eye-line size-4" />
      </button>
      <button
        type="button"
        aria-label={t(($) => $['skillManagement.detail.markdownSourceMode'])}
        title={t(($) => $['skillManagement.detail.markdownSourceMode'])}
        className={cn(
          'flex size-7 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          mode === 'source' &&
            'border-[0.5px] border-components-segmented-control-item-active-border bg-components-segmented-control-item-active-bg text-text-primary shadow-xs',
        )}
        onClick={() => onChange('source')}
      >
        <span aria-hidden className="i-ri-code-s-slash-line size-4" />
      </button>
    </div>
  )
}

export function ReferenceFilesPicker({
  anchor,
  confirmText,
  currentDirectory,
  emptyText,
  files,
  navigateText,
  onBack,
  onSelect,
  onSelectIndex,
  query,
  selectedIndex,
  title,
}: {
  anchor?: { x: number; y: number }
  confirmText: string
  currentDirectory: string
  emptyText: string
  files: SkillFileResponse[]
  navigateText: string
  onBack: () => void
  onSelect: (file: SkillFileResponse) => void
  onSelectIndex: (index: number) => void
  query: string
  selectedIndex: number
  title: string
}) {
  const safeAnchor = anchor ?? { x: 32, y: 64 }
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight
  const left = Math.min(safeAnchor.x, viewportWidth - 376)
  const top = Math.min(safeAnchor.y, viewportHeight - 340)

  return (
    <div
      className="fixed z-50 w-[360px] overflow-hidden rounded-xl border border-divider-regular bg-components-panel-bg shadow-lg"
      style={{
        left: Math.max(left, 16),
        top: Math.max(top, 16),
      }}
    >
      <div className="flex h-10 items-center gap-2 border-b border-divider-subtle px-3">
        <span aria-hidden className="i-ri-folder-3-line size-4 text-text-tertiary" />
        <span className="min-w-0 flex-1 truncate system-sm-medium text-text-secondary">
          {currentDirectory || title}
        </span>
        {query && (
          <span className="max-w-28 truncate system-xs-regular text-text-quaternary">{query}</span>
        )}
      </div>
      <div className="max-h-[280px] overflow-y-auto p-1">
        {currentDirectory && (
          <button
            type="button"
            className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={onBack}
          >
            <span
              aria-hidden
              className="i-ri-arrow-left-s-line size-4 shrink-0 text-text-tertiary"
            />
            <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">
              ..
            </span>
          </button>
        )}
        {files.length > 0 ? (
          files.map((referenceFile, index) => {
            const selected = index === selectedIndex

            return (
              <button
                key={referenceFile.path}
                type="button"
                className={cn(
                  'flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                  selected && 'bg-state-base-hover',
                )}
                onMouseEnter={() => onSelectIndex(index)}
                onClick={() => onSelect(referenceFile)}
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-4 shrink-0',
                    isDirectory(referenceFile) && selected
                      ? 'i-ri-folder-open-line text-text-secondary'
                      : getSkillFileIconClass(referenceFile),
                  )}
                />
                <span className="min-w-0 flex-1 truncate system-sm-regular text-text-secondary">
                  {getPathBaseName(referenceFile.path)}
                </span>
                {isDirectory(referenceFile) && (
                  <span
                    aria-hidden
                    className="i-ri-arrow-right-s-line size-4 text-text-quaternary"
                  />
                )}
              </button>
            )
          })
        ) : (
          <div className="px-3 py-8 text-center system-sm-regular text-text-tertiary">
            {emptyText}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 border-t border-divider-subtle px-3 py-2 system-xs-regular text-text-tertiary">
        <span>{navigateText}</span>
        <span>{confirmText}</span>
      </div>
    </div>
  )
}

export function EditableMetadataField({
  label,
  multiline = false,
  onLabelChange,
  onBlurCapture,
  onRemove,
  onValueChange,
  readOnly = false,
  value,
  valuePlaceholder,
}: {
  label: string
  multiline?: boolean
  onLabelChange?: (value: string) => void
  onBlurCapture?: FocusEventHandler<HTMLDivElement>
  onRemove?: () => void
  onValueChange?: (value: string) => void
  readOnly?: boolean
  value: string
  valuePlaceholder?: string
}) {
  const controlClassName =
    'w-full resize-none rounded-md border-0 bg-transparent px-1 py-0.5 text-[14px]/5 text-text-primary outline-hidden transition-[background-color,box-shadow] placeholder:text-text-quaternary hover:bg-state-base-hover focus:bg-components-input-bg-active focus:shadow-xs focus:inset-ring-1 focus:inset-ring-components-input-border-active'

  return (
    <div className="flex w-full flex-col gap-0.5" onBlurCapture={onBlurCapture}>
      <div className="flex h-6 items-center gap-1">
        {readOnly || !onLabelChange ? (
          <span className="min-w-0 truncate px-1 py-0.5 system-sm-medium text-text-tertiary">
            {label}
          </span>
        ) : (
          <input
            aria-label={label}
            value={label}
            className="[field-sizing:content] max-w-[calc(100%-28px)] min-w-0 rounded-[5px] border-0 bg-transparent px-1 py-0.5 system-sm-medium text-text-tertiary outline-hidden hover:bg-state-base-hover focus:bg-components-input-bg-active focus:text-text-placeholder focus:shadow-xs focus:inset-ring-1 focus:inset-ring-components-input-border-active"
            onChange={(event) => onLabelChange(event.target.value)}
          />
        )}
        {onRemove && !readOnly && (
          <button
            type="button"
            aria-label={`Remove ${label}`}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={onRemove}
          >
            <span aria-hidden className="i-ri-delete-bin-line size-3.5" />
          </button>
        )}
      </div>
      {readOnly || !onValueChange ? (
        <div className="min-h-6 px-1 py-0.5 text-[14px]/5 break-words whitespace-pre-wrap text-text-primary">
          {value || valuePlaceholder || '-'}
        </div>
      ) : multiline ? (
        <Textarea
          aria-label={`${label} value`}
          value={value}
          minRows={1}
          maxRows={8}
          placeholder={valuePlaceholder}
          className={controlClassName}
          onChange={(event) => onValueChange(event.target.value)}
        />
      ) : (
        <input
          aria-label={`${label} value`}
          value={value}
          placeholder={valuePlaceholder}
          className={controlClassName}
          onChange={(event) => onValueChange(event.target.value)}
        />
      )}
    </div>
  )
}

export function EditableMetadataEntry({
  entryKey,
  onCommit,
  onRemove,
  value,
}: {
  entryKey: string
  onCommit: (previousKey: string, nextKey: string, value: string) => void
  onRemove: () => void
  value: string
}) {
  const [keyDraft, setKeyDraft] = useState(entryKey)
  const [valueDraft, setValueDraft] = useState(value)

  const commit = () => {
    const nextKey = keyDraft.trim()
    if (!nextKey) {
      setKeyDraft(entryKey)
      return
    }
    if (nextKey === entryKey && valueDraft === value) return
    onCommit(entryKey, nextKey, valueDraft)
  }

  return (
    <EditableMetadataField
      label={keyDraft}
      value={valueDraft}
      multiline
      onLabelChange={setKeyDraft}
      onRemove={onRemove}
      onValueChange={setValueDraft}
      valuePlaceholder="Value"
      onBlurCapture={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        commit()
      }}
    />
  )
}

export function MarkdownSourceEditor({
  editorRef,
  onChange,
  onKeyDown,
  placeholder,
  readOnly,
  value,
}: {
  editorRef: RefObject<HTMLTextAreaElement | null>
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder: string
  readOnly: boolean
  value: string
}) {
  const [focused, setFocused] = useState(false)
  const [selectionOffset, setSelectionOffset] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const lineCount = Math.max(value.split('\n').length, 48)
  const currentLine = getCurrentLine(value, selectionOffset)
  const showPlaceholder = focused && currentLine.blank

  const syncSelection = (target: HTMLTextAreaElement) => {
    setSelectionOffset(target.selectionStart)
  }

  return (
    <div className="relative h-full overflow-hidden bg-background-default">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-10 overflow-hidden bg-background-default pt-1.5 text-right font-mono text-[13px]/[22px] text-text-quaternary"
      >
        <div style={{ transform: `translateY(${-scrollTop}px)` }}>
          {Array.from({ length: lineCount }, (_, index) => (
            <div key={index} className="h-[22px] pr-2">
              {String(index + 1).padStart(2, '0')}
            </div>
          ))}
        </div>
      </div>
      <textarea
        ref={editorRef}
        readOnly={readOnly}
        value={value}
        wrap="off"
        spellCheck={false}
        className={cn(
          'h-full w-full resize-none bg-transparent py-1.5 pr-20 pl-10 text-[14px]/[22px] text-text-primary outline-hidden read-only:text-text-secondary',
          styles.sourceTextarea,
        )}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          syncSelection(event.currentTarget)
          onChange(event)
        }}
        onClick={(event) => syncSelection(event.currentTarget)}
        onFocus={(event) => {
          setFocused(true)
          syncSelection(event.currentTarget)
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => syncSelection(event.currentTarget)}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onSelect={(event) => syncSelection(event.currentTarget)}
      />
      {showPlaceholder && (
        <EditorPlaceholder
          text={placeholder}
          className="absolute left-10 text-[14px]/[22px]"
          style={{ top: 6 + currentLine.lineIndex * 22 - scrollTop }}
        />
      )}
    </div>
  )
}

export function MarkdownBodyReferencePreview({
  body,
  className,
  onOpenReference,
  placeholder,
}: {
  body: string
  className?: string
  onOpenReference?: (path: string) => void
  placeholder: string
}) {
  const customComponents = useSkillMarkdownComponents(onOpenReference)

  if (!body) {
    return (
      <div className={cn('text-[15px]/7 whitespace-pre-wrap text-text-quaternary', className)}>
        {placeholder}
      </div>
    )
  }

  return (
    <Markdown
      content={body}
      customComponents={customComponents}
      remarkPlugins={SKILL_REFERENCE_REMARK_PLUGINS}
      className={cn('text-[15px]/7 text-text-secondary', className)}
    />
  )
}

export function MarkdownLiveBodyEditor({
  body,
  contentRevision,
  editorRef,
  onInput,
  onKeyDown,
  onOpenReference,
  placeholder,
}: {
  body: string
  contentRevision: number
  editorRef: RefObject<HTMLDivElement | null>
  onInput: (event: FormEvent<HTMLDivElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onOpenReference: (path: string) => void
  placeholder: string
}) {
  const renderedBodyRef = useRef<string | null>(null)
  const renderedContentRevisionRef = useRef(contentRevision)
  const pendingPreviewAnchorRef = useRef<{
    previousScrollTop: number
    scrollParent: HTMLElement
    selectionTop?: number
    sourceOffset: number
  } | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [selectionLineBlank, setSelectionLineBlank] = useState<boolean>()
  const [placeholderPosition, setPlaceholderPosition] = useState<{
    left: number
    top: number
  }>()
  const [selectionOffset, setSelectionOffset] = useState(0)
  const [referenceTooltip, setReferenceTooltip] = useState<{
    left: number
    path: string
    top: number
  } | null>(null)
  const currentLine = getCurrentLine(body, selectionOffset)
  const showPlaceholder =
    (!focused && !body.trim()) || (focused && (selectionLineBlank ?? currentLine.blank))
  const showRenderedPreview = !focused && Boolean(body.trim())
  const customComponents = useSkillMarkdownComponents(onOpenReference)

  const syncSelection = () => {
    const root = editorRef.current
    if (!root) return
    setSelectionOffset(getMarkdownLiveEditorSelectionOffset(root) ?? 0)
    setSelectionLineBlank(getSelectionLineBlank(root))
    setPlaceholderPosition(getSelectionLinePosition(root))
  }

  const getReferencePath = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return
    return target.closest<HTMLElement>('[data-reference-path]')?.dataset.referencePath
  }

  const enterEditMode = (root: HTMLElement, selectionOffset: number, clientY?: number) => {
    const scrollParent = getScrollParent(root)
    const previousScrollTop = scrollParent?.scrollTop

    setFocused(true)
    window.requestAnimationFrame(() => {
      const editor = editorRef.current
      if (!editor) return

      editor.focus({ preventScroll: true })
      setMarkdownLiveEditorSelectionOffset(editor, selectionOffset)
      setSelectionOffset(selectionOffset)
      setSelectionLineBlank(getSelectionLineBlank(editor))
      setPlaceholderPosition(getSelectionLinePosition(editor))

      if (!scrollParent || previousScrollTop == null) return
      if (clientY == null) {
        scrollParent.scrollTop = previousScrollTop
        return
      }

      const selectionRect = getSelectionRect(editor)
      if (selectionRect) scrollParent.scrollTop += selectionRect.top - clientY
      else scrollParent.scrollTop = previousScrollTop
    })
  }

  const exitEditMode = (root: HTMLElement) => {
    const scrollParent = getScrollParent(root)
    if (scrollParent) {
      pendingPreviewAnchorRef.current = {
        previousScrollTop: scrollParent.scrollTop,
        scrollParent,
        selectionTop: getSelectionRect(root)?.top,
        sourceOffset: getMarkdownLiveEditorSelectionOffset(root) ?? selectionOffset,
      }
    }

    setFocused(false)
  }

  useLayoutEffect(() => {
    if (focused) return

    const anchor = pendingPreviewAnchorRef.current
    const preview = previewRef.current
    if (!anchor || !preview) return

    const restoreAnchor = () => {
      const anchorRect = getMarkdownPreviewAnchorRect(preview, body, anchor.sourceOffset)
      if (!anchorRect || anchor.selectionTop == null) return false

      anchor.scrollParent.scrollTop += anchorRect.top - anchor.selectionTop
      pendingPreviewAnchorRef.current = null
      return true
    }

    if (restoreAnchor()) return

    const MutationObserver = preview.ownerDocument.defaultView?.MutationObserver
    if (!MutationObserver) {
      anchor.scrollParent.scrollTop = anchor.previousScrollTop
      pendingPreviewAnchorRef.current = null
      return
    }

    const observer = new MutationObserver(() => {
      if (restoreAnchor()) {
        observer.disconnect()
        return
      }

      if (preview.textContent?.trim()) {
        anchor.scrollParent.scrollTop = anchor.previousScrollTop
        pendingPreviewAnchorRef.current = null
        observer.disconnect()
      }
    })
    observer.observe(preview, { childList: true, subtree: true })

    return () => observer.disconnect()
  }, [body, focused])

  useLayoutEffect(() => {
    const root = editorRef.current
    if (!root) return
    const revisionChanged = renderedContentRevisionRef.current !== contentRevision
    if (renderedBodyRef.current === body && root.childNodes.length > 0 && !revisionChanged) return
    if (root.ownerDocument.activeElement === root && !revisionChanged) return

    renderMarkdownLiveEditorContent(root, body)
    renderedBodyRef.current = body
    renderedContentRevisionRef.current = contentRevision
  }, [body, contentRevision, editorRef, focused])

  useLayoutEffect(() => {
    if (!focused) return

    const root = editorRef.current
    if (!root) return

    const syncSelectionState = () => {
      setSelectionOffset(getMarkdownLiveEditorSelectionOffset(root) ?? 0)
      setSelectionLineBlank(getSelectionLineBlank(root))
      setPlaceholderPosition(getSelectionLinePosition(root))
    }
    const syncPlaceholderPosition = () => setPlaceholderPosition(getSelectionLinePosition(root))
    root.ownerDocument.addEventListener('selectionchange', syncSelectionState)

    const ResizeObserver = root.ownerDocument.defaultView?.ResizeObserver
    const observer = ResizeObserver ? new ResizeObserver(syncPlaceholderPosition) : null
    observer?.observe(root)

    return () => {
      root.ownerDocument.removeEventListener('selectionchange', syncSelectionState)
      observer?.disconnect()
    }
  }, [editorRef, focused])

  return (
    <div className="relative min-h-[360px]">
      {showRenderedPreview && (
        <div
          ref={previewRef}
          role="textbox"
          aria-label={placeholder}
          aria-multiline="true"
          tabIndex={0}
          className="relative z-[2] min-h-[360px] cursor-text outline-none focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClickCapture={(event) => {
            if (!(event.target instanceof HTMLElement)) return
            const anchor = event.target.closest<HTMLAnchorElement>('a[href]')
            const href = anchor?.getAttribute('href')
            if (!href || href.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(href)) return

            event.preventDefault()
            onOpenReference(decodeURIComponent(href))
          }}
          onMouseDown={(event) => {
            if (
              event.target instanceof HTMLElement &&
              event.target.closest('a[href], button[data-reference-path]')
            )
              return

            event.preventDefault()
            enterEditMode(
              event.currentTarget,
              getMarkdownPreviewSelectionOffset(
                event.currentTarget,
                event.target,
                body,
                event.clientX,
                event.clientY,
              ),
              event.clientY,
            )
          }}
          onFocus={(event) => {
            if (event.currentTarget !== event.target) return
            enterEditMode(event.currentTarget, 0)
          }}
        >
          <Markdown
            content={body}
            customComponents={customComponents}
            remarkPlugins={SKILL_REFERENCE_REMARK_PLUGINS}
          />
        </div>
      )}
      {!showRenderedPreview && (
        <div
          ref={editorRef}
          contentEditable
          role="textbox"
          aria-label={placeholder}
          aria-multiline="true"
          tabIndex={0}
          suppressContentEditableWarning
          className="relative z-[1] min-h-[360px] w-full bg-transparent text-[15px]/7 break-words whitespace-pre-wrap text-text-secondary caret-text-secondary outline-none"
          onBlur={(event) => exitEditMode(event.currentTarget)}
          onClick={(event: MouseEvent<HTMLDivElement>) => {
            const referencePath = getReferencePath(event.target)
            if (referencePath) {
              event.preventDefault()
              onOpenReference(referencePath)
              return
            }
            syncSelection()
          }}
          onFocus={() => {
            setFocused(true)
            syncSelection()
          }}
          onInput={(event) => {
            onInput(event)
            syncSelection()
          }}
          onKeyDown={(event) => {
            const referencePath = getReferencePath(event.target)
            if (referencePath && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault()
              onOpenReference(referencePath)
              return
            }
            onKeyDown(event)
          }}
          onKeyUp={syncSelection}
          onMouseOut={(event) => {
            const referencePath = getReferencePath(event.target)
            if (!referencePath) return
            if (
              event.relatedTarget instanceof HTMLElement &&
              getReferencePath(event.relatedTarget) === referencePath
            ) {
              return
            }
            setReferenceTooltip(null)
          }}
          onMouseOver={(event) => {
            if (!(event.target instanceof HTMLElement)) return
            const reference = event.target.closest<HTMLElement>('[data-reference-path]')
            const path = reference?.dataset.referencePath
            if (!reference || !path) return

            const rootRect = event.currentTarget.getBoundingClientRect()
            const referenceRect = reference.getBoundingClientRect()
            setReferenceTooltip({
              left: referenceRect.left - rootRect.left + referenceRect.width / 2,
              path,
              top: referenceRect.top - rootRect.top - 6,
            })
          }}
        />
      )}
      {referenceTooltip && (
        <span
          role="tooltip"
          style={{ left: referenceTooltip.left, top: referenceTooltip.top }}
          className="pointer-events-none absolute z-20 max-w-80 -translate-x-1/2 -translate-y-full rounded-lg border-[0.5px] border-components-panel-border bg-components-tooltip-bg px-2 py-1.5 system-xs-medium break-all whitespace-normal text-text-secondary shadow-lg backdrop-blur-[5px]"
        >
          {referenceTooltip.path}
        </span>
      )}
      {showPlaceholder && (
        <EditorPlaceholder
          text={placeholder}
          className="absolute text-[15px]/7"
          style={{
            left: placeholderPosition?.left ?? 0,
            top: placeholderPosition?.top ?? currentLine.lineIndex * 28,
          }}
        />
      )}
    </div>
  )
}

export function CsvTablePreview({ rows }: { rows: string[][] }) {
  const columnCount = rows.reduce((count, row) => Math.max(count, row.length), 0)

  if (rows.length === 0 || columnCount === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-background-default">
        <span className="system-sm-regular text-text-tertiary">-</span>
      </div>
    )
  }

  const [headerRow, ...bodyRows] = rows
  const headers = Array.from({ length: columnCount }, (_, index) => headerRow?.[index] ?? '')
  const columnKeys = Array.from({ length: columnCount }, (_, index) => `column-${index + 1}`)

  return (
    <div className="flex h-full flex-col gap-1 overflow-hidden bg-background-default p-1">
      <div className="flex h-6 shrink-0 items-center">
        <button
          type="button"
          className="flex h-6 items-center gap-1 rounded-md px-1.5 system-xs-medium text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        >
          <span aria-hidden className="i-ri-table-line size-3.5" />
          workspace
          <span aria-hidden className="i-ri-arrow-down-s-line size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 border-t border-l border-divider-subtle text-left">
          <thead className="sticky top-0 z-10 bg-background-section">
            <tr>
              {headers.map((header, index) => (
                <th
                  key={columnKeys[index]}
                  scope="col"
                  className="h-7 max-w-72 min-w-32 border-r border-b border-divider-subtle px-2 py-1 system-xs-medium text-text-secondary"
                >
                  <span className="block truncate" title={header || undefined}>
                    {header || `#${index + 1}`}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row) => (
              <tr key={row.join('\u0000')} className="hover:bg-state-base-hover">
                {columnKeys.map((columnKey, columnIndex) => {
                  const value = row[columnIndex] ?? ''

                  return (
                    <td
                      key={columnKey}
                      className="h-7 max-w-72 min-w-32 border-r border-b border-divider-subtle px-2 py-1 align-top system-xs-regular text-text-secondary"
                    >
                      <span
                        className="block break-words whitespace-pre-wrap"
                        title={value || undefined}
                      >
                        {value || '-'}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function VersionActionBar({
  onExit,
  onRestore,
  restoring,
  version,
}: {
  onExit: () => void
  onRestore: () => void
  restoring: boolean
  version: SkillVersionResponse
}) {
  const { t } = useTranslation('skill')
  const { formatTime } = useTimestamp()
  const publishedBy = version.published_by_name ?? version.published_by ?? '-'
  const publishedAt = formatTime(
    version.created_at,
    t(($) => $['skillManagement.dateTimeFormat']),
  )

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
      <div className="pointer-events-auto flex h-14 w-[428px] max-w-[calc(100%-2rem)] items-center gap-4 rounded-xl border border-divider-subtle bg-background-default px-4 shadow-xl">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate system-sm-semibold text-text-primary">
              {getSkillVersionTitle(version)}
            </span>
            <span className="border-state-accent-border shrink-0 rounded-[5px] border bg-state-accent-hover px-1.5 py-0.5 system-2xs-semibold-uppercase text-text-accent">
              {t(($) => $['skillManagement.detail.viewOnly'])}
            </span>
          </div>
          <div className="mt-0.5 truncate system-xs-regular text-text-tertiary">
            {t(($) => $['skillManagement.detail.versionPublishedMeta'], {
              name: publishedBy,
              time: publishedAt,
            })}
          </div>
        </div>
        <Button variant="primary" className="h-9 px-5" loading={restoring} onClick={onRestore}>
          {t(($) => $['skillManagement.detail.restoreVersion'])}
        </Button>
        <Button variant="secondary" className="h-9 px-4" onClick={onExit}>
          <span aria-hidden className="i-ri-history-line size-4" />
          {t(($) => $['skillManagement.detail.exitVersions'])}
        </Button>
      </div>
    </div>
  )
}
