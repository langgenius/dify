import type { ComponentType } from 'react'
import { createElement, lazy, Suspense, useState } from 'react'
import ErrorBoundary from '@/app/components/base/error-boundary'
import PanelLoading from './panel-loading'

// Keep the component identity stable while BasePanel injects updated node data
// and run parameters. Share explicit retries with future mounts so reopening a
// recovered panel does not reuse the original lazy component's cached rejection.
export function lazyPanel<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
) {
  let CurrentPanel = lazy(load)

  return function LazyPanel(props: Props) {
    const [Panel, setPanel] = useState(() => CurrentPanel)

    const retry = () => {
      CurrentPanel = lazy(load)
      setPanel(() => CurrentPanel)
    }

    return (
      <ErrorBoundary onReset={retry}>
        <Suspense fallback={<PanelLoading />}>{createElement(Panel, props)}</Suspense>
      </ErrorBoundary>
    )
  }
}
