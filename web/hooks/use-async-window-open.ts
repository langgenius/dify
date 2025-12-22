import { useCallback } from 'react'

type GetUrl = () => Promise<string | null | undefined>

type AsyncWindowOpenOptions = {
  immediateUrl?: string | null
  target?: string
  features?: string
  onError?: (error: Error) => void
}

export const useAsyncWindowOpen = () => useCallback(async (getUrl: GetUrl, options?: AsyncWindowOpenOptions) => {
  const {
    immediateUrl,
    target = '_blank',
    features,
    onError,
  } = options ?? {}

  const secureImmediateFeatures = features ? `${features},noopener,noreferrer` : 'noopener,noreferrer'

  if (immediateUrl) {
    const newWindow = window.open(immediateUrl, target, secureImmediateFeatures)
    if (!newWindow) {
      onError?.(new Error('Failed to open new window'))
      return
    }
    try {
      newWindow.opener = null
    }
    catch { /* noop */ }
    return
  }

  const newWindow = window.open('about:blank', target, features)
  if (!newWindow) {
    onError?.(new Error('Failed to open new window'))
    return
  }

  try {
    newWindow.opener = null
  }
  catch { /* noop */ }

  try {
    const url = await getUrl()
    if (url) {
      newWindow.location.href = url
      return
    }
    newWindow.close()
    onError?.(new Error('No url resolved for new window'))
  }
  catch (error) {
    newWindow.close()
    onError?.(error instanceof Error ? error : new Error(String(error)))
  }
}, [])
