'use client'

import type {
  SkillFileResponse,
  SkillVersionResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { FormEvent, KeyboardEvent, RefObject } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import useTimestamp from '@/hooks/use-timestamp'
import {
  getPathBaseName,
  getReferenceIconClass,
  getReferencePathSegments,
  getSkillFileIconClass,
  getSkillVersionTitle,
  isDirectory,
  parseMarkdownBodyReferences,
  renderMarkdownLiveEditorContent,
} from './shared'

export function MarkdownModeSwitch({
  mode,
  onChange,
}: {
  mode: 'live' | 'source'
  onChange: (mode: 'live' | 'source') => void
}) {
  const { t } = useTranslation('skill')

  return (
    <div className="absolute top-3 right-3 z-10 flex h-8 items-center rounded-lg border border-divider-subtle bg-background-default p-0.5 shadow-xs">
      <button
        type="button"
        aria-label={t(($) => $['skillManagement.detail.markdownLiveMode'])}
        title={t(($) => $['skillManagement.detail.markdownLiveMode'])}
        className={cn(
          'flex size-7 cursor-pointer items-center justify-center rounded-md text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          mode === 'live' && 'bg-state-base-hover text-text-primary shadow-xs',
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
          mode === 'source' && 'bg-state-base-hover text-text-primary shadow-xs',
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

export function MarkdownBodyReferencePreview({
  body,
  className,
  placeholder,
}: {
  body: string
  className?: string
  placeholder: string
}) {
  const segments = parseMarkdownBodyReferences(body)

  if (!body) {
    return (
      <div className={cn('text-[15px]/7 whitespace-pre-wrap text-text-quaternary', className)}>
        {placeholder}
      </div>
    )
  }

  return (
    <div className={cn('text-[15px]/7 whitespace-pre-wrap text-text-secondary', className)}>
      {segments.map((segment) => {
        if (segment.type === 'text') return <span key={segment.key}>{segment.text}</span>

        const pathSegments = getReferencePathSegments(segment.path, segment.label)

        return (
          <span
            key={segment.key}
            className="mx-0.5 inline-flex translate-y-1 items-center gap-0.5"
            title={segment.path}
          >
            {pathSegments.map((pathSegment, segmentIndex) => {
              const partialPath = pathSegments.slice(0, segmentIndex + 1).join('/')
              const isLastSegment = segmentIndex === pathSegments.length - 1

              return (
                <span
                  key={partialPath}
                  className="inline-flex h-6 items-center gap-1 rounded-md border border-util-colors-blue-blue-300 bg-util-colors-blue-blue-100 px-1.5 text-util-colors-blue-blue-700"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-4 shrink-0',
                      isLastSegment
                        ? getReferenceIconClass(segment.path)
                        : 'i-ri-folder-5-line text-util-colors-blue-blue-600',
                    )}
                  />
                  <span className="max-w-48 truncate">{pathSegment}</span>
                </span>
              )
            })}
          </span>
        )
      })}
    </div>
  )
}

export function MarkdownLiveBodyEditor({
  body,
  contentRevision,
  editorRef,
  onInput,
  onKeyDown,
  placeholder,
}: {
  body: string
  contentRevision: number
  editorRef: RefObject<HTMLDivElement | null>
  onInput: (event: FormEvent<HTMLDivElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  placeholder: string
}) {
  const renderedBodyRef = useRef<string | null>(null)
  const renderedContentRevisionRef = useRef(contentRevision)

  useLayoutEffect(() => {
    const root = editorRef.current
    if (!root) return
    const revisionChanged = renderedContentRevisionRef.current !== contentRevision
    if (renderedBodyRef.current === body && !revisionChanged) return
    if (root.ownerDocument.activeElement === root && !revisionChanged) return

    renderMarkdownLiveEditorContent(root, body)
    renderedBodyRef.current = body
    renderedContentRevisionRef.current = contentRevision
  }, [body, contentRevision, editorRef])

  return (
    <div
      ref={editorRef}
      contentEditable
      role="textbox"
      aria-multiline="true"
      tabIndex={0}
      suppressContentEditableWarning
      className="relative min-h-[360px] w-full bg-transparent text-[15px]/7 break-words whitespace-pre-wrap text-text-secondary caret-text-secondary outline-none empty:before:pointer-events-none empty:before:text-text-quaternary empty:before:content-[attr(data-placeholder)]"
      data-placeholder={placeholder}
      onInput={onInput}
      onKeyDown={onKeyDown}
    />
  )
}

export function CsvTablePreview({ rows }: { rows: string[][] }) {
  const columnCount = rows.reduce((count, row) => Math.max(count, row.length), 0)

  if (rows.length === 0 || columnCount === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-divider-regular bg-background-default">
        <span className="system-sm-regular text-text-tertiary">-</span>
      </div>
    )
  }

  const [headerRow, ...bodyRows] = rows
  const headers = Array.from({ length: columnCount }, (_, index) => headerRow?.[index] ?? '')
  const columnKeys = Array.from({ length: columnCount }, (_, index) => `column-${index + 1}`)

  return (
    <div className="h-full overflow-auto rounded-xl border border-divider-regular bg-background-default">
      <table className="min-w-full border-separate border-spacing-0 text-left">
        <thead className="sticky top-0 z-10 bg-background-section">
          <tr>
            {headers.map((header, index) => (
              <th
                key={columnKeys[index]}
                scope="col"
                className="max-w-72 min-w-32 border-r border-b border-divider-subtle px-3 py-2 system-xs-semibold-uppercase text-text-tertiary last:border-r-0"
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
                    className="max-w-72 min-w-32 border-r border-b border-divider-subtle px-3 py-2 align-top system-sm-regular text-text-secondary last:border-r-0"
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
