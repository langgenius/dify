import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { atom, createStore, Provider, useAtomValue } from 'jotai'
import { QueryTestingAdapter } from 'nuqs-jotai/testing'
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
  it('isolates owner inputs while sibling instances share global URL state', () => {
    const store = createStore()
    store.set(parentValueAtom, 'parent-visible')

    render(
      <Provider store={store}>
        <QueryTestingAdapter searchParams="?window=7d">
          <OverviewStateBoundary knowledgeSpaceId="space-a">
            <OverviewInputs label="first" />
          </OverviewStateBoundary>
          <OverviewStateBoundary knowledgeSpaceId="space-b">
            <OverviewInputs label="second" />
          </OverviewStateBoundary>
        </QueryTestingAdapter>
      </Provider>,
    )

    expect(screen.getByText('first:space-a:7d:parent-visible')).toBeInTheDocument()
    expect(screen.getByText('second:space-b:7d:parent-visible')).toBeInTheDocument()
  })

  it('resets owner-local sessions when the knowledge space identity changes', async () => {
    const user = userEvent.setup()
    const rendered = render(
      <QueryTestingAdapter searchParams="?window=24h">
        <OverviewStateBoundary knowledgeSpaceId="space-a">
          <LocalSession />
        </OverviewStateBoundary>
      </QueryTestingAdapter>,
    )

    await user.click(screen.getByRole('button', { name: '0' }))
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument()

    act(() =>
      rendered.rerender(
        <QueryTestingAdapter searchParams="?window=24h">
          <OverviewStateBoundary knowledgeSpaceId="space-b">
            <LocalSession />
          </OverviewStateBoundary>
        </QueryTestingAdapter>,
      ),
    )

    expect(screen.getByRole('button', { name: '0' })).toBeInTheDocument()
  })
})
