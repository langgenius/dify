import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { atom, createStore, Provider, useAtomValue } from 'jotai'
import { NuqsJotaiBridge } from 'nuqs-jotai'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { overviewKnowledgeSpaceIdAtom, overviewLocationQuery, overviewWindowAtom } from '../state'
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
        <NuqsTestingAdapter searchParams="?window=7d">
          <NuqsJotaiBridge config={overviewLocationQuery}>
            <OverviewStateBoundary knowledgeSpaceId="space-a">
              <OverviewInputs label="first" />
            </OverviewStateBoundary>
            <OverviewStateBoundary knowledgeSpaceId="space-b">
              <OverviewInputs label="second" />
            </OverviewStateBoundary>
          </NuqsJotaiBridge>
        </NuqsTestingAdapter>
      </Provider>,
    )

    expect(screen.getByText('first:space-a:7d:parent-visible')).toBeInTheDocument()
    expect(screen.getByText('second:space-b:7d:parent-visible')).toBeInTheDocument()
  })

  it('resets owner-local sessions when the knowledge space identity changes', async () => {
    const user = userEvent.setup()
    const rendered = render(
      <NuqsTestingAdapter searchParams="?window=24h">
        <NuqsJotaiBridge config={overviewLocationQuery}>
          <OverviewStateBoundary knowledgeSpaceId="space-a">
            <LocalSession />
          </OverviewStateBoundary>
        </NuqsJotaiBridge>
      </NuqsTestingAdapter>,
    )

    await user.click(screen.getByRole('button', { name: '0' }))
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument()

    act(() =>
      rendered.rerender(
        <NuqsTestingAdapter searchParams="?window=24h">
          <NuqsJotaiBridge config={overviewLocationQuery}>
            <OverviewStateBoundary knowledgeSpaceId="space-b">
              <LocalSession />
            </OverviewStateBoundary>
          </NuqsJotaiBridge>
        </NuqsTestingAdapter>,
      ),
    )

    expect(screen.getByRole('button', { name: '0' })).toBeInTheDocument()
  })
})
