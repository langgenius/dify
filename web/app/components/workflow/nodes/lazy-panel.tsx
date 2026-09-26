import type { ComponentType } from 'react'
import { createElement, lazy, Suspense } from 'react'
import ErrorBoundary from '@/app/components/base/error-boundary'
import PanelLoading from './panel-loading'

class PanelImportError extends Error {}

const canRetryPanel = (error: Error) => !(error instanceof PanelImportError)

// A failed native import is cached by the browser, not just React.lazy. Offer
// an explicit page reload for import failures; rendering errors can still retry
// locally without discarding the surrounding workflow editor.
export function lazyPanel<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
) {
  const Panel = lazy(async () => {
    try {
      return await load()
    } catch (cause) {
      throw new PanelImportError('Failed to load workflow node panel', { cause })
    }
  })

  return function LazyPanel(props: Props) {
    return (
      <ErrorBoundary canRetry={canRetryPanel}>
        <Suspense fallback={<PanelLoading />}>{createElement(Panel, props)}</Suspense>
      </ErrorBoundary>
    )
  }
}
