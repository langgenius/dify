import type { SaveFileOptions, SaveResult } from '../../../hooks/use-skill-save-manager'
import { useEffect, useRef } from 'react'

type UseFileFallbackLifecycleProps = {
  fileTabId: string | null
  isEditable: boolean
  hasLoadedContent: boolean
  originalContent: string
  currentMetadata: Record<string, unknown> | undefined
  saveFile: (fileId: string, options?: SaveFileOptions) => Promise<SaveResult>
  registerFallback: (fileId: string, entry: { content: string, metadata?: Record<string, unknown> }) => void
  unregisterFallback: (fileId: string) => void
}

export const useFileFallbackLifecycle = ({
  fileTabId,
  isEditable,
  hasLoadedContent,
  originalContent,
  currentMetadata,
  saveFile,
  registerFallback,
  unregisterFallback,
}: UseFileFallbackLifecycleProps) => {
  const saveFileRef = useRef(saveFile)
  saveFileRef.current = saveFile

  const fallbackRef = useRef({
    content: originalContent,
    metadata: currentMetadata,
  })

  useEffect(() => {
    if (!fileTabId || !hasLoadedContent)
      return

    const fallback = {
      content: originalContent,
      metadata: currentMetadata,
    }

    fallbackRef.current = fallback
    registerFallback(fileTabId, fallback)

    return () => {
      unregisterFallback(fileTabId)
    }
  }, [
    currentMetadata,
    fileTabId,
    hasLoadedContent,
    originalContent,
    registerFallback,
    unregisterFallback,
  ])

  useEffect(() => {
    if (!fileTabId || !isEditable)
      return

    return () => {
      const { content: fallbackContent, metadata: fallbackMetadata } = fallbackRef.current
      void saveFileRef.current(fileTabId, {
        fallbackContent,
        fallbackMetadata,
      })
    }
  }, [fileTabId, isEditable])
}
