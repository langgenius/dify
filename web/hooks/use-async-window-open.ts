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

      if (url && newWindow) {
        newWindow.location.href = url
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
        const error = new Error('Invalid URL or window was closed')
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
