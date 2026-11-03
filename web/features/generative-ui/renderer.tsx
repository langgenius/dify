'use client'

import type { OpenUIError, ParseResult } from '@openuidev/react-lang'
import type { GenerativeUIAction } from './actions'
import { Renderer } from '@openuidev/react-lang'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from '#i18n'
import { toGenerativeUIAction } from './actions'
import { InteractionsDisabledContext } from './components/interaction-context'
import { GENERATIVE_UI_LIBRARY_VERSION } from './registry/definitions'
import { difyUILibrary } from './registry/library'

export type GenerativeUIRendererProps = {
  source: string
  libraryVersion: string
  isStreaming: boolean
  isReadOnly?: boolean
  initialState?: Record<string, unknown>
  fallbackText: string
  onStateUpdate?: (state: Record<string, unknown>) => void
  onAction?: (action: GenerativeUIAction) => void
}

export const GenerativeUIRenderer = memo(
  ({ libraryVersion, ...props }: GenerativeUIRendererProps) => {
    const { t } = useTranslation(['appDebug'])
    if (libraryVersion !== GENERATIVE_UI_LIBRARY_VERSION) {
      return (
        <p className="body-md-regular text-text-secondary">
          {props.fallbackText || t(($) => $['generativeUI.unavailable'])}
        </p>
      )
    }
    return <CurrentLibraryRenderer {...props} />
  },
)

function CurrentLibraryRenderer({
  source,
  isStreaming,
  isReadOnly = false,
  initialState,
  fallbackText,
  onStateUpdate,
  onAction,
}: Omit<GenerativeUIRendererProps, 'libraryVersion'>) {
  const { t } = useTranslation(['appDebug'])
  // Saved responses can arrive after newer edits. Hydrate once for this block's mounted draft.
  const [hydratedState] = useState(() => initialState)
  const [hasComponentError, setHasComponentError] = useState(false)
  const [hasUsableRoot, setHasUsableRoot] = useState(true)
  const [hasMissingContent, setHasMissingContent] = useState(false)
  const reportErrors = useCallback((errors: OpenUIError[]) => {
    setHasComponentError(errors.some((error) => error.severity !== 'warning'))
  }, [])
  const inspectProgram = useCallback((result: ParseResult | null) => {
    const children: unknown = result?.root?.props.children
    setHasUsableRoot(
      !!result?.root &&
        result.root.typeName === 'Stack' &&
        !result.root.partial &&
        Array.isArray(children) &&
        children.length > 0,
    )
    setHasMissingContent(!!result && (result.meta.incomplete || result.meta.unresolved.length > 0))
  }, [])
  const disabled = isStreaming || isReadOnly || !onAction
  const showFallback = !isStreaming && (!hasUsableRoot || !source.trim())

  return (
    <div aria-busy={isStreaming}>
      {isStreaming && !source.trim() && (
        <p role="status" className="body-sm-regular text-text-tertiary">
          {t(($) => $['generativeUI.loading'])}
        </p>
      )}
      {showFallback && (
        <p className="body-md-regular text-text-secondary">
          {fallbackText || t(($) => $['generativeUI.unavailable'])}
        </p>
      )}
      {!isStreaming && !showFallback && (hasComponentError || hasMissingContent) && (
        <p className="body-md-regular text-text-secondary">
          {t(($) => $['generativeUI.unavailable'])}
        </p>
      )}
      <div hidden={showFallback}>
        <InteractionsDisabledContext value={disabled || showFallback}>
          <Renderer
            library={difyUILibrary}
            response={source}
            isStreaming={isStreaming}
            initialState={hydratedState}
            onStateUpdate={onStateUpdate}
            onAction={(event) => {
              if (disabled || showFallback) return
              const action = toGenerativeUIAction(event)
              if (action) onAction?.(action)
            }}
            onError={reportErrors}
            onParseResult={inspectProgram}
          />
        </InteractionsDisabledContext>
      </div>
    </div>
  )
}
