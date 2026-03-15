/**
 * @fileoverview Markdown Editor Component for Markdown Code Blocks
 *
 * Renders interactive Markdown editor with editing and action capabilities.
 * Supports both streaming (AI response) and complete data scenarios.
 *
 * @example Usage in Markdown - Inline Data with Single Action:
 * ```editableMarkdown
 * {
 *   "content": "# Hello World\n\nThis is editable markdown content.",
 *   "actions": [
 *     {
 *       "url": "https://api.example.com/submit",
 *       "headers": { "Authorization": "Bearer token" },
 *       "buttonText": "Submit Content",
 *       "buttonIcon": "submit",
 *       "buttonVariant": "primary"
 *     }
 *   ]
 * }
 * ```
 *
 * @example Multiple Action Buttons:
 * ```editableMarkdown
 * {
 *   "content": "# Document\n\nContent here...",
 *   "actions": [
 *     {
 *       "url": "https://api.example.com/save",
 *       "buttonText": "Save Draft",
 *       "buttonVariant": "secondary"
 *     },
 *     {
 *       "url": "https://api.example.com/publish",
 *       "buttonText": "Publish",
 *       "buttonVariant": "primary"
 *     }
 *   ]
 * }
 * ```
 *
 * @example Read-only with URL:
 * ```editableMarkdown
 * {
 *   "url": "https://raw.githubusercontent.com/example/README.md",
 *   "editable": false
 * }
 * ```
 *
 * @example Action with Auto-send Message:
 * ```editableMarkdown
 * {
 *   "content": "# Task List\n\n- [ ] Review PR\n- [ ] Deploy",
 *   "actions": [
 *     {
 *       "url": "https://api.example.com/submit",
 *       "buttonText": "Save & Continue"
 *     }
 *   ],
 *   "postAction": [
 *     {
 *       "type": "sendMessage",
 *       "message": "I've saved the task list. What's next?"
 *     }
 *   ]
 * }
 * ```
 *
 * @example Action with Toast Notification:
 * ```editableMarkdown
 * {
 *   "content": "# Document\n\nContent to save...",
 *   "actions": [
 *     {
 *       "url": "https://api.example.com/save",
 *       "buttonText": "Save Document"
 *     }
 *   ],
 *   "postAction": [
 *     {
 *       "type": "showToast",
 *       "message": "Document saved successfully!",
 *       "toastType": "success"
 *     }
 *   ]
 * }
 * ```
 *
 * @example Multiple Post Actions:
 * ```editableMarkdown
 * {
 *   "content": "# Report\n\nFinal report content...",
 *   "actions": [
 *     {
 *       "url": "https://api.example.com/publish",
 *       "buttonText": "Publish"
 *     }
 *   ],
 *   "postAction": [
 *     {
 *       "type": "showToast",
 *       "message": "Report published!",
 *       "toastType": "success"
 *     },
 *     {
 *       "type": "sendMessage",
 *       "message": "Would you like to share it?"
 *     }
 *   ]
 * }
 * ```
 *
 * @example API Response with Next Action:
 * ```json
 * {
 *    "status": "success",
 *    "nextAction": [
 *      {
 *        "type": "sendMessage",
 *        "message": "The data has been submitted. Would you like me to generate a report?"
 *      }
 *    ]
 * }
 * ```
 *
 * @example API Response with Toast Notification:
 * ```json
 * {
 *    "status": "success",
 *    "nextAction": [
 *      {
 *        "type": "showToast",
 *        "message": "Content has been published!",
 *        "toastType": "success"
 *      }
 *    ]
 * }
 * ```
 *
 * @example API Response with Multiple Actions:
 * ```json
 * {
 *    "status": "success",
 *    "nextAction": [
 *      {
 *        "type": "showToast",
 *        "message": "Operation successful!",
 *        "toastType": "success"
 *      },
 *      {
 *        "type": "sendMessage",
 *        "message": "What would you like to do next?"
 *      }
 *    ]
 * }
 * ```
 * @features
 * - Progressive streaming rendering: displays partial content as it arrives
 * - Full-screen mode with ESC/click-backdrop/button exit
 * - Inline editing with @uiw/react-md-editor
 * - Preview/Edit/Split mode support
 * - Multiple action buttons support with custom text, icon, variant
 * - Custom action callback support
 * - Post-action messaging (auto-send message)
 * - API response nextAction support
 * - Dark/Light mode support
 * - Portal-based fullscreen (z-index independent)
 */
import type { ActionConfig, PostAction } from './hooks/use-editor-common'
import { RiFullscreenExitLine, RiFullscreenLine, RiLoader2Line, RiSaveLine } from '@remixicon/react'
import MDEditor from '@uiw/react-md-editor'
import copy from 'copy-to-clipboard'
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { Copy, CopyCheck } from '@/app/components/base/icons/src/vender/line/files'
import Toast from '@/app/components/base/toast'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { cn } from '@/utils/classnames'
import { useChatContext } from '../chat/chat/context'
import {
  executeApiAction,
  executeCustomAction,
  loadPersistedData,
  useDataPersistence,
  useEscapeFullscreen,
} from './hooks/use-editor-common'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Component props
 * @property content - Raw markdown code block content (JSON string)
 * @property isDarkMode - Theme mode for styling
 * @property messageId - Optional message ID for persisting data
 */
type MarkdownEditorProps = {
  content: string
  isDarkMode: boolean
  messageId?: string
}

type MarkdownConfig = {
  url?: string
  content?: string
  editable?: boolean
  actions?: ActionConfig<string>[] // Action buttons
  postAction?: PostAction
}

// ============================================================================
// Pure helper functions (defined outside component to avoid re-creation)
// ============================================================================

/** Unescape JSON string content */
function unescapeJsonString(str: string): string {
  const BACKSLASH_PLACEHOLDER = '\u0000'
  let result = str
  result = result.replace(/\\\\/g, BACKSLASH_PLACEHOLDER)
  result = result.replace(/\\n/g, '\n')
  result = result.replace(/\\r/g, '\r')
  result = result.replace(/\\t/g, '\t')
  result = result.replace(/\\"/, '"')
  result = result.replace(/\\'/g, '\'')
  result = result.replace(/\\`/g, '`')
  result = result.split(BACKSLASH_PLACEHOLDER).join('\\\\')
  return result
}

/** Fix JSON with real newlines in string values */
function fixJsonNewlines(jsonStr: string): string {
  try {
    const obj = JSON.parse(jsonStr)
    return JSON.stringify(obj)
  }
  catch {
    return jsonStr.replace(
      /"([^"\\]|\\.)*"/g,
      (match) => {
        return match.replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t')
      },
    )
  }
}

/**
 * Parse MarkdownConfig from raw content string.
 * Returns the parsed config, streaming state, and whether a parse error occurred.
 */
function parseMarkdownConfig(content: string): { config: MarkdownConfig | null, isStreaming: boolean, parseError: boolean } {
  if (!content || !content.trim())
    return { config: null, isStreaming: false, parseError: false }

  try {
    const trimmedContent = content.trim()
    const fixedContent = fixJsonNewlines(trimmedContent)
    let jsonContent = fixedContent
    const lastBraceIndex = fixedContent.lastIndexOf('}')

    if (lastBraceIndex !== -1 && lastBraceIndex < fixedContent.length - 1)
      jsonContent = fixedContent.substring(0, lastBraceIndex + 1)

    try {
      const parsedConfig = JSON.parse(jsonContent) as MarkdownConfig
      return { config: parsedConfig, isStreaming: false, parseError: false }
    }
    catch {
      // JSON not complete yet
    }

    const contentMatch = trimmedContent.match(/"content"\s*:\s*"([\s\S]*?)"(?=\s*[,}]|$)/)
    if (contentMatch) {
      return {
        config: { content: unescapeJsonString(contentMatch[1]), editable: true },
        isStreaming: true,
        parseError: false,
      }
    }

    const fallbackMatch = trimmedContent.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*)/)
    if (fallbackMatch) {
      return {
        config: { content: unescapeJsonString(fallbackMatch[1] ?? ''), editable: true },
        isStreaming: true,
        parseError: false,
      }
    }

    if (trimmedContent.endsWith('}'))
      return { config: null, isStreaming: false, parseError: true }

    return { config: null, isStreaming: true, parseError: false }
  }
  catch {
    return { config: null, isStreaming: false, parseError: false }
  }
}

// ============================================================================
// Reducer for data-loading state (avoids direct setState in useEffect)
// ============================================================================
type MarkdownDataAction
  = | { type: 'LOAD_START' }
    | { type: 'LOAD_SUCCESS', content: string }
    | { type: 'LOAD_ERROR' }
    | { type: 'SET_CONTENT', content: string }

type MarkdownDataState = {
  loading: boolean
  markdownContent: string
}

function markdownDataReducer(state: MarkdownDataState, action: MarkdownDataAction): MarkdownDataState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true }
    case 'LOAD_SUCCESS':
      return { loading: false, markdownContent: action.content }
    case 'LOAD_ERROR':
      return { loading: false, markdownContent: '' }
    case 'SET_CONTENT':
      return { ...state, markdownContent: action.content }
    default:
      return state
  }
}

const MarkdownEditor = memo(({ content, isDarkMode, messageId }: MarkdownEditorProps) => {
  const { t } = useTranslation()
  const { onSend } = useChatContext()
  const [executingActionIndex, setExecutingActionIndex] = useState<number | null>(null)
  const [{ loading, markdownContent }, dispatch] = useReducer(markdownDataReducer, { loading: false, markdownContent: '' })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmingActionIndex, setConfirmingActionIndex] = useState<number>(0)
  const hasLoadedPersistedDataRef = useRef(false)
  const isStreamingRef = useRef(false)

  // Handle ESC key to exit fullscreen
  useEscapeFullscreen(isFullscreen, setIsFullscreen)

  // Parse configuration using pure function; config is fully derived from content
  const parsedResult = useMemo(() => parseMarkdownConfig(content), [content])

  // config is derived state – no useState needed, useMemo is sufficient
  const config = useMemo(() => parsedResult.config, [parsedResult.config])

  // Sync streaming flag and show toast on parse error (no setState calls here)
  useEffect(() => {
    isStreamingRef.current = parsedResult.isStreaming
    if (parsedResult.parseError) {
      Toast.notify({
        type: 'error',
        message: t('chat.markdownEditor.invalidFormat', { ns: 'common' }),
      })
    }
  }, [parsedResult, t])

  // Load data from URL or inline; dispatch keeps setState out of useEffect
  const loadMarkdownData = useCallback((cfg: MarkdownConfig) => {
    const shouldLoadPersisted = !isStreamingRef.current && !hasLoadedPersistedDataRef.current && messageId

    if (shouldLoadPersisted) {
      const persisted = loadPersistedData<string>(messageId, 'markdown-data')
      if (persisted) {
        dispatch({ type: 'SET_CONTENT', content: persisted })
        hasLoadedPersistedDataRef.current = true
        return
      }
    }

    if (cfg.url) {
      dispatch({ type: 'LOAD_START' })
      fetch(cfg.url)
        .then(response => response.text())
        .then((data) => {
          dispatch({ type: 'LOAD_SUCCESS', content: data })
          hasLoadedPersistedDataRef.current = true
        })
        .catch((err: Error) => {
          Toast.notify({
            type: 'error',
            message: `${t('chat.markdownEditor.loadFailed', { ns: 'common' })}: ${err.message}`,
          })
          dispatch({ type: 'LOAD_ERROR' })
          hasLoadedPersistedDataRef.current = true
        })
      return
    }

    if (cfg.content !== undefined) {
      dispatch({ type: 'SET_CONTENT', content: cfg.content })
      hasLoadedPersistedDataRef.current = true
      return
    }

    if (!isStreamingRef.current) {
      Toast.notify({
        type: 'error',
        message: t('chat.markdownEditor.invalidFormat', { ns: 'common' }),
      })
    }
    dispatch({ type: 'SET_CONTENT', content: '' })
    hasLoadedPersistedDataRef.current = true
  }, [messageId, t])

  useEffect(() => {
    if (!config)
      return
    loadMarkdownData(config)
  }, [config, loadMarkdownData])

  // Persist data changes to localStorage
  useDataPersistence(
    markdownContent,
    config,
    isStreamingRef.current,
    hasLoadedPersistedDataRef.current,
    messageId,
    'markdown-data',
  )

  // Handle copy content to clipboard
  const handleCopy = useCallback(() => {
    copy(markdownContent)
    setIsCopied(true)

    setTimeout(() => {
      setIsCopied(false)
    }, 2000)
  }, [markdownContent])

  const handleAction = useCallback(async (actionIndex: number = 0) => {
    const currentAction = config?.actions?.[actionIndex]
    if (!currentAction)
      return

    // Custom callback
    if (currentAction.onSuccess) {
      await executeCustomAction(
        markdownContent,
        currentAction,
        config,
        onSend,
        setShowConfirm,
        t('chat.markdownEditor.actionFailed', { ns: 'common' }),
      )
      setExecutingActionIndex(null)
      return
    }

    // Execute API action
    if (currentAction.url) {
      setExecutingActionIndex(actionIndex)
      await executeApiAction(
        markdownContent,
        currentAction,
        config,
        onSend,
        (executing: boolean) => {
          if (!executing)
            setExecutingActionIndex(null)
        },
        setShowConfirm,
        'content',
        t('api.actionSuccess', { ns: 'common' }),
        t('chat.markdownEditor.actionFailed', { ns: 'common' }),
      )
    }
  }, [config, markdownContent, onSend, t])

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <RiLoader2Line className="h-6 w-6 animate-spin text-text-tertiary" />
        <span className="ml-2 text-sm text-text-secondary">{t('chat.markdownEditor.loadingData', { ns: 'common' })}</span>
      </div>
    )
  }

  // Show "no data" only when streaming is complete and we have no content
  if (!isStreamingRef.current && !markdownContent && !config) {
    return (
      <div className="rounded-lg border border-divider-subtle bg-background-section-burn p-4">
        <div className="text-sm text-text-secondary">{t('chat.markdownEditor.noData', { ns: 'common' })}</div>
      </div>
    )
  }

  const isEditable = config?.editable !== false

  // Create a reusable toolbar component
  const renderToolbar = (isFullscreenView = false) => (
    <div className="flex items-center justify-between border-b border-divider-subtle bg-background-section-burn p-2">
      <div className="system-xs-semibold-uppercase text-text-secondary">
        {t('chat.markdownEditor.title', { ns: 'common' })}
      </div>
      <div className="flex items-center gap-2">
        {/* Copy button */}
        <Tooltip>
          <TooltipTrigger
            render={(
              <button
                onClick={handleCopy}
                className="flex h-7 items-center gap-1 rounded-md px-2 transition-colors hover:bg-state-base-hover"
              />
            )}
          >
            {isCopied
              ? (
                  <CopyCheck className="h-3.5 w-3.5 text-text-tertiary" />
                )
              : (
                  <Copy className="h-3.5 w-3.5 text-text-tertiary" />
                )}
          </TooltipTrigger>
          <TooltipContent>
            {isCopied ? t('chat.markdownEditor.copied', { ns: 'common' }) : t('chat.markdownEditor.copyContent', { ns: 'common' })}
          </TooltipContent>
        </Tooltip>
        {/* Fullscreen toggle */}
        <Button
          variant="secondary"
          size="small"
          onClick={() => isFullscreenView ? setIsFullscreen(false) : setIsFullscreen(true)}
          className="flex items-center gap-1"
        >
          {isFullscreenView
            ? (
                <>
                  <RiFullscreenExitLine className="h-4 w-4" />
                  <span>{t('chat.markdownEditor.exitFullscreen', { ns: 'common' })}</span>
                </>
              )
            : (
                <>
                  <RiFullscreenLine className="h-4 w-4" />
                  <span>{t('chat.markdownEditor.fullscreen', { ns: 'common' })}</span>
                </>
              )}
        </Button>
        {/* Action buttons */}
        {config?.actions && config.actions.length > 0 && (
          <>
            {config.actions.map((action, index) => {
              const isExecuting = executingActionIndex === index
              return (
                <Button
                  key={index}
                  variant={action?.buttonVariant || 'primary'}
                  size="small"
                  onClick={() => {
                    setConfirmingActionIndex(index)
                    setShowConfirm(true)
                  }}
                  disabled={isExecuting || executingActionIndex !== null}
                  className="flex items-center gap-1"
                >
                  {isExecuting
                    ? (
                        <RiLoader2Line className="h-4 w-4 animate-spin" />
                      )
                    : (
                        <RiSaveLine className="h-4 w-4" />
                      )}
                  <span>
                    {isExecuting ? t('chat.markdownEditor.executing', { ns: 'common' }) : (action?.buttonText || t('chat.markdownEditor.submit', { ns: 'common' }))}
                  </span>
                </Button>
              )
            })}
          </>
        )}
      </div>
    </div>
  )

  // Render normal (non-fullscreen) view
  const renderNormalView = () => (
    <div className="w-full rounded-lg border border-divider-subtle bg-components-input-bg-normal">
      {/* Toolbar */}
      {renderToolbar(false)}
      {/* Editor */}
      <div
        className={cn(
          'w-full overflow-auto',
          isDarkMode ? 'markdown-editor-dark' : 'markdown-editor-light',
        )}
        data-color-mode={isDarkMode ? 'dark' : 'light'}
      >
        <MDEditor
          value={markdownContent}
          onChange={(val) => {
            if (isEditable)
              dispatch({ type: 'SET_CONTENT', content: val || '' })
          }}
          preview={isEditable ? 'live' : 'preview'}
          hideToolbar={!isEditable}
          height={400}
          visibleDragbar={false}
        />
      </div>
    </div>
  )

  // Render fullscreen view using portal
  const renderFullscreenView = () => createPortal(
    <div className="fixed inset-0 z-[10000000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      {/* Editor container */}
      <div
        className="bg-background-default-normal relative flex h-full max-w-full flex-col rounded-lg border border-divider-subtle"
        style={{ width: '95%' }}
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        {/* Toolbar */}
        {renderToolbar(true)}
        {/* Editor */}
        <div
          className={cn(
            'flex-1 overflow-auto',
            isDarkMode ? 'markdown-editor-dark' : 'markdown-editor-light',
          )}
          data-color-mode={isDarkMode ? 'dark' : 'light'}
        >
          <MDEditor
            value={markdownContent}
            onChange={(val) => {
              if (isEditable)
                dispatch({ type: 'SET_CONTENT', content: val || '' })
            }}
            preview={isEditable ? 'live' : 'preview'}
            hideToolbar={!isEditable}
            height="100%"
            visibleDragbar={false}
          />
        </div>
      </div>
      {/* Click outside to close */}
      <div
        className="fixed inset-0 -z-10"
        onClick={() => setIsFullscreen(false)}
        onContextMenu={e => e.preventDefault()}
      />
    </div>,
    document.body,
  )

  // Main render
  return (
    <>
      {renderNormalView()}
      {isFullscreen && renderFullscreenView()}

      {/* Action confirmation dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <div className="p-6">
            <AlertDialogTitle className="mb-2 text-text-primary title-2xl-semi-bold">
              {t('chat.markdownEditor.actionConfirmTitle', { ns: 'common' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-text-secondary body-md-regular">
              {t('chat.markdownEditor.actionConfirmContent', { ns: 'common' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton variant="secondary" onClick={() => setShowConfirm(false)}>
              {t('chat.markdownEditor.cancelButton', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={executingActionIndex !== null}
              onClick={() => handleAction(confirmingActionIndex)}
            >
              {t('chat.markdownEditor.actionConfirmButton', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
})

MarkdownEditor.displayName = 'MarkdownEditor'

export default MarkdownEditor
