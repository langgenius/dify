import type { ComponentType } from 'react'
import { createElement, lazy, Suspense, useState } from 'react'
import ErrorBoundary from '@/app/components/base/error-boundary'
import PanelLoading from './panel-loading'

// Keep the component identity stable while BasePanel injects updated node data
// and run parameters. Only a failed import's explicit retry replaces it.
export function lazyPanel<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
) {
  const InitialPanel = lazy(load)

  return function LazyPanel(props: Props) {
    const [Panel, setPanel] = useState(() => InitialPanel)

    return (
      <ErrorBoundary onReset={() => setPanel(() => lazy(load))}>
        <Suspense fallback={<PanelLoading />}>{createElement(Panel, props)}</Suspense>
      </ErrorBoundary>
    )
  }
}
