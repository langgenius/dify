/**
 * @fileoverview Common hooks and utilities for editor components
 *
 * Shared functionality between ExcelViewer and MarkdownEditor:
 * - ESC key handling for fullscreen exit
 * - Post-action message sending
 * - Data persistence to localStorage
 * - Action execution (API calls and callbacks)
 */
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { useChatContext } from '../../chat/chat/context'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Single post-action configuration
 */
export type PostActionItem = {
  type: 'sendMessage' | 'showToast'
  message: string
  toastType?: 'info' | 'success' | 'warning' | 'error' // Optional toast type, default: 'info'
}

/**
 * Post-action configuration (array of actions)
 */
export type PostAction = PostActionItem[]

/**
 * Action configuration for buttons
 */
export type ActionConfig<T = any> = {
  url: string
  headers?: Record<string, string>
  method?: 'POST' | 'PUT' | 'PATCH'
  buttonText?: string
  buttonIcon?: 'save' | 'submit' | 'send' | 'upload' | 'confirm'
  buttonVariant?: 'primary' | 'secondary' | 'warning'
  onSuccess?: (data: T) => void
}

/**
 * Config with post-action support
 */
export type ConfigWithPostAction = {
  actions?: ActionConfig[]
  postAction?: PostAction
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to handle ESC key for exiting fullscreen mode
 *
 * @param isFullscreen - Current fullscreen state
 * @param setIsFullscreen - Function to update fullscreen state
 *
 * @example
 * ```tsx
 * const [isFullscreen, setIsFullscreen] = useState(false)
 * useEscapeFullscreen(isFullscreen, setIsFullscreen)
 * ```
 */
export function useEscapeFullscreen(
  isFullscreen: boolean,
  setIsFullscreen: (value: boolean) => void,
) {
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isFullscreen)
        setIsFullscreen(false)
    }

    if (isFullscreen) {
      window.addEventListener('keydown', handleEscKey)
      return () => window.removeEventListener('keydown', handleEscKey)
    }
  }, [isFullscreen, setIsFullscreen])
}

/**
 * Hook to persist data changes to localStorage with debouncing
 *
 * @param data - Data to persist (any serializable type)
 * @param config - Configuration object
 * @param isStreaming - Whether content is still streaming
 * @param hasLoadedPersisted - Whether persisted data has been loaded
 * @param messageId - Message ID for storage key
 * @param storageKeyPrefix - Prefix for localStorage key (e.g., 'excel-data', 'markdown-data')
 * @param debounceMs - Debounce delay in milliseconds (default: 500)
 *
 * @example
 * ```tsx
 * useDataPersistence(
 *   data,
 *   config,
 *   isStreamingRef.current,
 *   hasLoadedPersistedDataRef.current,
 *   messageId,
 *   'excel-data'
 * )
 * ```
 */
export function useDataPersistence<T>(
  data: T | null,
  config: unknown,
  isStreaming: boolean,
  hasLoadedPersisted: boolean,
  messageId: string | undefined,
  storageKeyPrefix: string,
  debounceMs = 500,
) {
  const persistDataRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Skip if no data or invalid state
    if (!data || !config || isStreaming || !hasLoadedPersisted || !messageId)
      return

    const storageKey = `${storageKeyPrefix}-${messageId}`

    // Clear previous timeout
    if (persistDataRef.current)
      clearTimeout(persistDataRef.current)

    // Debounced persist
    persistDataRef.current = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(data))
      }
      catch (e) {
        console.error(`[${storageKeyPrefix}] Failed to persist data:`, e)
      }
    }, debounceMs)
  }, [data, config, isStreaming, hasLoadedPersisted, messageId, storageKeyPrefix, debounceMs])
}

/**
 * Load persisted data from localStorage
 *
 * @param messageId - Message ID for storage key
 * @param storageKeyPrefix - Prefix for localStorage key
 * @returns Parsed data or null if not found
 */
export function loadPersistedData<T>(
  messageId: string,
  storageKeyPrefix: string,
): T | null {
  const storageKey = `${storageKeyPrefix}-${messageId}`
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored)
      return JSON.parse(stored) as T

    return null
  }
  catch (e) {
    console.error(`[${storageKeyPrefix}] Failed to load persisted data:`, e)
    return null
  }
}

// ============================================================================
// Action Execution Utilities
// ============================================================================

/**
 * Handle post-action message sending or toast notification
 * Supports multiple actions executed in sequence
 *
 * @param postAction - Post-action configuration (array of actions)
 * @param onSend - Chat send function
 */
export function executePostAction(
  postAction: PostAction | undefined,
  onSend?: (message: string) => void,
) {
  if (!postAction || postAction.length === 0)
    return

  postAction.forEach((action, index) => {
    if (action.type === 'sendMessage' && onSend) {
      // Delay sendMessage to ensure it happens after toasts
      setTimeout(() => {
        onSend(action.message)
      }, 100 * (index + 1))
    }
    else if (action.type === 'showToast') {
      // Add small delay for each toast to avoid conflicts
      setTimeout(() => {
        Toast.notify({
          type: action.toastType || 'info',
          message: action.message,
        })
      }, 100 * index)
    }
  })
}

/**
 * Execute custom action with callback
 *
 * @param data - Data to pass to callback
 * @param action - Action configuration
 * @param fullConfig - Full configuration with postAction
 * @param onSend - Chat send function
 * @param setShowConfirm - Function to close confirm dialog
 * @param errorTranslation - Error message translation
 */
export async function executeCustomAction<T>(
  data: T,
  action: ActionConfig<T>,
  fullConfig: ConfigWithPostAction,
  onSend: ((message: string) => void) | undefined,
  setShowConfirm: (value: boolean) => void,
  errorTranslation: string,
) {
  try {
    if (action.onSuccess)
      action.onSuccess(data)

    setShowConfirm(false)

    // Handle post-action
    executePostAction(fullConfig.postAction, onSend)
  }
  catch (e) {
    Toast.notify({
      type: 'error',
      message: e instanceof Error ? e.message : errorTranslation,
    })
    setShowConfirm(false)
  }
}

/**
 * Execute API action with POST request
 *
 * @param data - Data to send in request body
 * @param action - Action configuration
 * @param fullConfig - Full configuration with postAction
 * @param onSend - Chat send function
 * @param setExecuting - Function to update executing state
 * @param setShowConfirm - Function to close confirm dialog
 * @param dataKey - Key name for data in request body (e.g., 'data', 'content')
 * @param successTranslation - Success message translation
 * @param errorTranslation - Error message translation
 */
export async function executeApiAction<T>(
  data: T,
  action: ActionConfig<T>,
  fullConfig: ConfigWithPostAction,
  onSend: ((message: string) => void) | undefined,
  setExecuting: (value: boolean) => void,
  setShowConfirm: (value: boolean) => void,
  dataKey: string,
  successTranslation: string,
  errorTranslation: string,
) {
  setExecuting(true)
  try {
    const response = await fetch(action.url, {
      method: action.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...action.headers,
      },
      body: JSON.stringify({ [dataKey]: data }),
    })

    if (!response.ok)
      throw new Error(`Action failed: ${response.statusText}`)

    // Parse response to check for nextAction
    const responseText = await response.text()
    let nextAction: PostAction | undefined

    try {
      const responseData = JSON.parse(responseText)
      if (responseData.nextAction)
        nextAction = responseData.nextAction
    }
    catch {
      // Response is not JSON, ignore
    }

    setShowConfirm(false)

    // Handle post-action from config first, then API response
    if (fullConfig.postAction) {
      executePostAction(fullConfig.postAction, onSend)
    }
    else if (nextAction) {
      executePostAction(nextAction, onSend)
    }
    else {
      // Only show default success toast if no postAction/nextAction
      Toast.notify({
        type: 'success',
        message: successTranslation,
      })
    }
  }
  catch (e) {
    Toast.notify({
      type: 'error',
      message: e instanceof Error ? e.message : errorTranslation,
    })
  }
  finally {
    setExecuting(false)
    setShowConfirm(false)
  }
}

/**
 * Hook to create action handler
 *
 * @param data - Data to send
 * @param config - Configuration with action
 * @param setExecuting - Function to update executing state
 * @param setShowConfirm - Function to close confirm dialog
 * @param dataKey - Key name for data in request body
 *
 * @returns Action handler function
 *
 * @example
 * ```tsx
 * const handleAction = useActionHandler(
 *   data,
 *   config,
 *   setExecuting,
 *   setShowConfirm,
 *   'data'
 * )
 * ```
 */
export function useActionHandler<T, C extends { action?: ActionConfig<T> } & ConfigWithPostAction>(
  data: T,
  config: C | null,
  setExecuting: (value: boolean) => void,
  setShowConfirm: (value: boolean) => void,
  dataKey: string,
) {
  const { t } = useTranslation()
  const { onSend } = useChatContext()

  return async () => {
    if (!config?.action)
      return

    // Custom callback
    if (config.action.onSuccess) {
      await executeCustomAction(
        data,
        config.action,
        config,
        onSend,
        setShowConfirm,
        t('api.actionFailed', { ns: 'common' }),
      )
      return
    }

    // Execute API action
    if (config.action.url) {
      await executeApiAction(
        data,
        config.action,
        config,
        onSend,
        setExecuting,
        setShowConfirm,
        dataKey,
        t('api.actionSuccess', { ns: 'common' }),
        t('api.actionFailed', { ns: 'common' }),
      )
    }
  }
}
