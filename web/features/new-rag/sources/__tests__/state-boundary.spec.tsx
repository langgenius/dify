import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { atom, createStore, Provider, useAtomValue, useSetAtom } from 'jotai'
import {
  removedSourceIdsAtom,
  removeSourceFromListAtom,
  sourcesAwaitedOperationIdAtom,
  sourcesFilterAtom,
  sourcesKnowledgeSpaceIdAtom,
  sourcesSearchAtom,
  sourcesSortAtom,
} from '../state'
import { SourcesStateBoundary } from '../state-boundary'

const parentValueAtom = atom('missing')

function SourcesInputs({ label }: { label: string }) {
  const knowledgeSpaceId = useAtomValue(sourcesKnowledgeSpaceIdAtom)
  const filter = useAtomValue(sourcesFilterAtom)
  const search = useAtomValue(sourcesSearchAtom)
  const sort = useAtomValue(sourcesSortAtom)
  const awaitedOperationId = useAtomValue(sourcesAwaitedOperationIdAtom)
  const parentValue = useAtomValue(parentValueAtom)
  return (
    <p>{`${label}:${knowledgeSpaceId}:${filter}:${search}:${sort}:${awaitedOperationId}:${parentValue}`}</p>
  )
}

function RemovedSourcesSession() {
  const removedSourceIds = useAtomValue(removedSourceIdsAtom)
  const removeSource = useSetAtom(removeSourceFromListAtom)
  return (
    <button onClick={() => removeSource('source-1')}>
      {[...removedSourceIds].join(',') || 'none'}
    </button>
  )
}

describe('SourcesStateBoundary', () => {
  it('isolates route inputs between sibling instances while observing the parent store', () => {
    const store = createStore()
    store.set(parentValueAtom, 'parent-visible')

    render(
      <Provider store={store}>
        <SourcesStateBoundary
          awaitedOperationId="operation-a"
          filter="active"
          knowledgeSpaceId="space-a"
          search="alpha"
          sort="name-asc"
        >
          <SourcesInputs label="first" />
        </SourcesStateBoundary>
        <SourcesStateBoundary
          awaitedOperationId={null}
          filter="error"
          knowledgeSpaceId="space-b"
          search="beta"
          sort="name-desc"
        >
          <SourcesInputs label="second" />
        </SourcesStateBoundary>
      </Provider>,
    )

    expect(
      screen.getByText('first:space-a:active:alpha:name-asc:operation-a:parent-visible'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('second:space-b:error:beta:name-desc:null:parent-visible'),
    ).toBeInTheDocument()
  })

  it('follows authoritative URL inputs without resetting the space session', async () => {
    const user = userEvent.setup()
    const rendered = render(
      <SourcesStateBoundary
        awaitedOperationId={null}
        filter="all"
        knowledgeSpaceId="space-a"
        search=""
        sort={null}
      >
        <SourcesInputs label="sources" />
        <RemovedSourcesSession />
      </SourcesStateBoundary>,
    )

    await user.click(screen.getByRole('button', { name: 'none' }))
    expect(screen.getByRole('button', { name: 'source-1' })).toBeInTheDocument()

    act(() =>
      rendered.rerender(
        <SourcesStateBoundary
          awaitedOperationId="operation-2"
          filter="syncing"
          knowledgeSpaceId="space-a"
          search="docs"
          sort="name-asc"
        >
          <SourcesInputs label="sources" />
          <RemovedSourcesSession />
        </SourcesStateBoundary>,
      ),
    )

    expect(
      screen.getByText('sources:space-a:syncing:docs:name-asc:operation-2:missing'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'source-1' })).toBeInTheDocument()
  })

  it('resets workflow primitives when the knowledge space identity changes', async () => {
    const user = userEvent.setup()
    const rendered = render(
      <SourcesStateBoundary
        awaitedOperationId={null}
        filter="all"
        knowledgeSpaceId="space-a"
        search=""
        sort={null}
      >
        <RemovedSourcesSession />
      </SourcesStateBoundary>,
    )

    await user.click(screen.getByRole('button', { name: 'none' }))
    expect(screen.getByRole('button', { name: 'source-1' })).toBeInTheDocument()

    act(() =>
      rendered.rerender(
        <SourcesStateBoundary
          awaitedOperationId={null}
          filter="all"
          knowledgeSpaceId="space-b"
          search=""
          sort={null}
        >
          <RemovedSourcesSession />
        </SourcesStateBoundary>,
      ),
    )

    expect(screen.getByRole('button', { name: 'none' })).toBeInTheDocument()
  })
})
