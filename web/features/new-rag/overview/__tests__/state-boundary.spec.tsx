import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { atom, createStore, Provider, useAtomValue } from 'jotai'
import { useState } from 'react'
import { overviewKnowledgeSpaceIdAtom, overviewWindowAtom } from '../state'
import { OverviewStateBoundary } from '../state-boundary'

const parentValueAtom = atom('missing')

function OverviewInputs({ label }: { label: string }) {
  const knowledgeSpaceId = useAtomValue(overviewKnowledgeSpaceIdAtom)
  const window = useAtomValue(overviewWindowAtom)
  const parentValue = useAtomValue(parentValueAtom)
  return <p>{`${label}:${knowledgeSpaceId}:${window}:${parentValue}`}</p>
}

function LocalSession() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount((current) => current + 1)}>{count}</button>
}

describe('OverviewStateBoundary', () => {
  it('isolates route inputs between sibling instances while observing the parent store', () => {
    const store = createStore()
    store.set(parentValueAtom, 'parent-visible')

    render(
      <Provider store={store}>
        <OverviewStateBoundary knowledgeSpaceId="space-a" window="24h">
          <OverviewInputs label="first" />
        </OverviewStateBoundary>
        <OverviewStateBoundary knowledgeSpaceId="space-b" window="7d">
          <OverviewInputs label="second" />
        </OverviewStateBoundary>
      </Provider>,
    )

    expect(screen.getByText('first:space-a:24h:parent-visible')).toBeInTheDocument()
    expect(screen.getByText('second:space-b:7d:parent-visible')).toBeInTheDocument()
  })

  it('resets owner-local sessions when the knowledge space identity changes', async () => {
    const user = userEvent.setup()
    const rendered = render(
      <OverviewStateBoundary knowledgeSpaceId="space-a" window="24h">
        <LocalSession />
      </OverviewStateBoundary>,
    )

    await user.click(screen.getByRole('button', { name: '0' }))
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument()

    act(() =>
      rendered.rerender(
        <OverviewStateBoundary knowledgeSpaceId="space-b" window="24h">
          <LocalSession />
        </OverviewStateBoundary>,
      ),
    )

    expect(screen.getByRole('button', { name: '0' })).toBeInTheDocument()
  })
})
