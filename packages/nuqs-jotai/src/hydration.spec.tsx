import { act } from '@testing-library/react'
import { useAtomValueRawSync } from 'jotai'
import { parseAsInteger } from 'nuqs'
import { NuqsAdapter } from 'nuqs/adapters/react'
import { useLayoutEffect } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { expect, it, vi } from 'vite-plus/test'
import { createQueryGroup, QueryStateProvider } from './index'

it('hydrates from the server snapshot and then adopts the current browser URL', async () => {
  window.history.replaceState(null, '', '/?page=7')
  const pageGroup = createQueryGroup({ page: parseAsInteger.withDefault(1) })
  const page = pageGroup.fields.page
  const seen: number[] = []
  function Reader() {
    const value = useAtomValueRawSync(page)
    useLayoutEffect(() => {
      seen.push(value)
    }, [value])
    return <p>{value}</p>
  }
  function App() {
    return (
      <NuqsAdapter serverSearch="page=1">
        <QueryStateProvider groups={[pageGroup]}>
          <Reader />
        </QueryStateProvider>
      </NuqsAdapter>
    )
  }
  const container = document.createElement('div')
  container.innerHTML = renderToString(<App />)
  document.body.append(container)
  const onRecoverableError = vi.fn()
  let root!: ReturnType<typeof hydrateRoot>
  try {
    expect(container.textContent).toBe('1')
    await act(async () => {
      root = hydrateRoot(container, <App />, { onRecoverableError })
    })
    expect(onRecoverableError).not.toHaveBeenCalled()
    expect(seen[0]).toBe(1)
    expect(container.textContent).toBe('7')
  } finally {
    act(() => root?.unmount())
    container.remove()
  }
})
