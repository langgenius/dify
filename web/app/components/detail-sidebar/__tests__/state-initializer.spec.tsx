import type { DetailSidebarMode } from '../preference'
import { Provider, useAtomValue } from 'jotai'
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { detailSidebarModeAtom } from '../state'
import { DetailSidebarStateInitializer } from '../state-initializer'

function DetailSidebarModeValue() {
  return <span>{useAtomValue(detailSidebarModeAtom)}</span>
}

function renderInitializer(initialMode: DetailSidebarMode) {
  return (
    <Provider>
      <DetailSidebarStateInitializer initialMode={initialMode}>
        <DetailSidebarModeValue />
      </DetailSidebarStateInitializer>
    </Provider>
  )
}

describe('DetailSidebarStateInitializer', () => {
  it('uses the same request snapshot for server rendering and client hydration', async () => {
    const container = document.createElement('div')
    container.innerHTML = renderToString(renderInitializer('collapse'))
    document.body.append(container)
    const recoverableErrors: unknown[] = []

    expect(container).toHaveTextContent('collapse')

    const root = hydrateRoot(container, renderInitializer('collapse'), {
      onRecoverableError: (error) => recoverableErrors.push(error),
    })
    await act(async () => {})

    expect(container).toHaveTextContent('collapse')
    expect(recoverableErrors).toEqual([])

    await act(async () => root.unmount())
    container.remove()
  })
})
