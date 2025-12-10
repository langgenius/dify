import { useCallback } from 'react'
import Toast from '@/app/components/base/toast'

export type AsyncWindowOpenOptions = {
  successMessage?: string
  errorMessage?: string
  windowFeatures?: string
  onError?: (error: any) => void
  onSuccess?: (url: string) => void
}

export const useAsyncWindowOpen = () => {
  const openAsync = useCallback(async (
    fetchUrl: () => Promise<string>,
    options: AsyncWindowOpenOptions = {},
  ) => {
    const {
      successMessage,
      errorMessage = 'Failed to open page',
      windowFeatures = 'noopener,noreferrer',
      onError,
      onSuccess,
    } = options

    const newWindow = window.open('', '_blank', windowFeatures)

    try {
      const url = await fetchUrl()

      if (url) {
        if (newWindow) {
          try {
            newWindow.opener = null
          }
          catch { /* noop */ }
          newWindow.location.href = url
        }
        else {
          // Fallback: navigate current tab if we couldn't get a window reference
          window.location.href = url
        }
        onSuccess?.(url)

        if (successMessage) {
          Toast.notify({
            type: 'success',
            message: successMessage,
          })
        }
      }
      else {
        newWindow?.close()
        const error = new Error('Invalid URL received')
        onError?.(error)
        Toast.notify({
          type: 'error',
          message: errorMessage,
        })
      }
    }
    catch (error) {
      newWindow?.close()
      onError?.(error)
      Toast.notify({
        type: 'error',
        message: errorMessage,
      })
    }
  }, [])

  return { openAsync }
}
