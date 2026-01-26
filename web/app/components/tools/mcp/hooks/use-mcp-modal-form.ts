'use client'
import type { HeaderItem } from '../headers-input'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useCallback, useMemo, useRef, useState } from 'react'
import { getDomain } from 'tldts'
import { v4 as uuid } from 'uuid'
import Toast from '@/app/components/base/toast'
import { MCPAuthMethod } from '@/app/components/tools/types'
import { uploadRemoteFileInfo } from '@/service/common'

const DEFAULT_ICON = { type: 'emoji', icon: '🔗', background: '#6366F1' }

const extractFileId = (url: string) => {
  const match = url.match(/files\/(.+?)\/file-preview/)
  return match ? match[1] : null
}

const getIcon = (data?: ToolWithProvider): AppIconSelection => {
  if (!data)
    return DEFAULT_ICON as AppIconSelection
  if (typeof data.icon === 'string')
    return { type: 'image', url: data.icon, fileId: extractFileId(data.icon) } as AppIconSelection
  return {
    ...data.icon,
    icon: data.icon.content,
    type: 'emoji',
  } as unknown as AppIconSelection
}

const getInitialHeaders = (data?: ToolWithProvider): HeaderItem[] => {
  return Object.entries(data?.masked_headers || {}).map(([key, value]) => ({ id: uuid(), key, value }))
}

export const isValidUrl = (string: string) => {
  try {
    const url = new URL(string)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}

export const isValidServerID = (str: string) => {
  return /^[a-z0-9_-]{1,24}$/.test(str)
}

export type MCPModalFormState = {
  url: string
  name: string
  appIcon: AppIconSelection
  showAppIconPicker: boolean
  serverIdentifier: string
  timeout: number
  sseReadTimeout: number
  headers: HeaderItem[]
  isFetchingIcon: boolean
  authMethod: MCPAuthMethod
  isDynamicRegistration: boolean
  clientID: string
  credentials: string
}

export type MCPModalFormActions = {
  setUrl: (url: string) => void
  setName: (name: string) => void
  setAppIcon: (icon: AppIconSelection) => void
  setShowAppIconPicker: (show: boolean) => void
  setServerIdentifier: (id: string) => void
  setTimeout: (timeout: number) => void
  setSseReadTimeout: (timeout: number) => void
  setHeaders: (headers: HeaderItem[]) => void
  setAuthMethod: (method: string) => void
  setIsDynamicRegistration: (value: boolean) => void
  setClientID: (id: string) => void
  setCredentials: (credentials: string) => void
  handleUrlBlur: (url: string) => Promise<void>
  resetIcon: () => void
}

/**
 * Custom hook for MCP Modal form state management.
 *
 * Note: This hook uses a `formKey` (data ID or 'create') to reset form state when
 * switching between edit and create modes. All useState initializers read from `data`
 * directly, and the key change triggers a remount of the consumer component.
 */
export const useMCPModalForm = (data?: ToolWithProvider) => {
  const isCreate = !data
  const originalServerUrl = data?.server_url
  const originalServerID = data?.server_identifier

  // Form key for resetting state - changes when data changes
  const formKey = useMemo(() => data?.id ?? 'create', [data?.id])

  // Form state - initialized from data
  const [url, setUrl] = useState(() => data?.server_url || '')
  const [name, setName] = useState(() => data?.name || '')
  const [appIcon, setAppIcon] = useState<AppIconSelection>(() => getIcon(data))
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [serverIdentifier, setServerIdentifier] = useState(() => data?.server_identifier || '')
  const [timeout, setMcpTimeout] = useState(() => data?.configuration?.timeout || 30)
  const [sseReadTimeout, setSseReadTimeout] = useState(() => data?.configuration?.sse_read_timeout || 300)
  const [headers, setHeaders] = useState<HeaderItem[]>(() => getInitialHeaders(data))
  const [isFetchingIcon, setIsFetchingIcon] = useState(false)
  const appIconRef = useRef<HTMLDivElement>(null)

  // Auth state
  const [authMethod, setAuthMethod] = useState(MCPAuthMethod.authentication)
  const [isDynamicRegistration, setIsDynamicRegistration] = useState(() => isCreate ? true : (data?.is_dynamic_registration ?? true))
  const [clientID, setClientID] = useState(() => data?.authentication?.client_id || '')
  const [credentials, setCredentials] = useState(() => data?.authentication?.client_secret || '')

  const handleUrlBlur = useCallback(async (urlValue: string) => {
    if (data)
      return
    if (!isValidUrl(urlValue))
      return
    const domain = getDomain(urlValue)
    const remoteIcon = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
    setIsFetchingIcon(true)
    try {
      const res = await uploadRemoteFileInfo(remoteIcon, undefined, true)
      setAppIcon({ type: 'image', url: res.url, fileId: extractFileId(res.url) || '' })
    }
    catch (e) {
      let errorMessage = 'Failed to fetch remote icon'
      if (e instanceof Response) {
        try {
          const errorData = await e.json()
          if (errorData?.code)
            errorMessage = `Upload failed: ${errorData.code}`
        }
        catch {
          // Ignore JSON parsing errors
        }
      }
      else if (e instanceof Error) {
        errorMessage = e.message
      }
      console.error('Failed to fetch remote icon:', e)
      Toast.notify({ type: 'warning', message: errorMessage })
    }
    finally {
      setIsFetchingIcon(false)
    }
  }, [data])

  const resetIcon = useCallback(() => {
    setAppIcon(getIcon(data))
  }, [data])

  const handleAuthMethodChange = useCallback((value: string) => {
    setAuthMethod(value as MCPAuthMethod)
  }, [])

  return {
    // Key for form reset (use as React key on parent)
    formKey,

    // Metadata
    isCreate,
    originalServerUrl,
    originalServerID,
    appIconRef,

    // State
    state: {
      url,
      name,
      appIcon,
      showAppIconPicker,
      serverIdentifier,
      timeout,
      sseReadTimeout,
      headers,
      isFetchingIcon,
      authMethod,
      isDynamicRegistration,
      clientID,
      credentials,
    } satisfies MCPModalFormState,

    // Actions
    actions: {
      setUrl,
      setName,
      setAppIcon,
      setShowAppIconPicker,
      setServerIdentifier,
      setTimeout: setMcpTimeout,
      setSseReadTimeout,
      setHeaders,
      setAuthMethod: handleAuthMethodChange,
      setIsDynamicRegistration,
      setClientID,
      setCredentials,
      handleUrlBlur,
      resetIcon,
    } satisfies MCPModalFormActions,
  }
}
