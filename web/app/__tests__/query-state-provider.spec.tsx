import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider, useAtomValueRawSync, useSetAtom } from 'jotai'
import { throttle, useQueryState } from 'nuqs'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { documentDetailLocationAtoms } from '@/features/new-rag/documents/detail/state/location'
import { documentSearchParser } from '@/features/new-rag/documents/query-state'
import { documentSearchAtom } from '@/features/new-rag/documents/state/inputs'
import { overviewQueryGroup } from '@/features/new-rag/overview/query-state'
import { retrievalQueryGroup } from '@/features/new-rag/retrieval/state/inputs'
import { QueryStateProvider } from '../query-state-provider'

function ReadGroups() {
  const window = useAtomValueRawSync(overviewQueryGroup.fields.window)
  const search = useAtomValueRawSync(documentSearchAtom)
  const revision = useAtomValueRawSync(documentDetailLocationAtoms.revision)
  const trace = useAtomValueRawSync(retrievalQueryGroup.fields.trace)
  return (
    <p>
      {window}/{search}/{revision}/{trace}
    </p>
  )
}

it('registers all New RAG URL groups under the application provider', () => {
  render(
    <Provider>
      <NuqsTestingAdapter searchParams="?window=7d&query=hello&revision=3&trace=run">
        <QueryStateProvider>
          <ReadGroups />
        </QueryStateProvider>
      </NuqsTestingAdapter>
    </Provider>,
  )
  expect(screen.getByText('7d/hello/3/run')).toBeInTheDocument()
})

it('shares typed state between native nuqs and registered atom consumers', async () => {
  const user = userEvent.setup()
  function Readers() {
    const value = useAtomValueRawSync(documentSearchAtom)
    const setValue = useSetAtom(documentSearchAtom)
    const [native, setNative] = useQueryState('query', documentSearchParser)
    return (
      <>
        <p>Atom: {value}</p>
        <p>Native: {native}</p>
        <button onClick={() => void setValue('atom', { limitUrlUpdates: throttle(0) })}>
          Write atom
        </button>
        <button onClick={() => void setNative('native', { limitUrlUpdates: throttle(0) })}>
          Write native
        </button>
      </>
    )
  }
  render(
    <Provider>
      <NuqsTestingAdapter hasMemory>
        <QueryStateProvider>
          <Readers />
        </QueryStateProvider>
      </NuqsTestingAdapter>
    </Provider>,
  )
  await user.click(screen.getByRole('button', { name: 'Write atom' }))
  expect(screen.getByText('Native: atom')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Write native' }))
  expect(screen.getByText('Atom: native')).toBeInTheDocument()
})
