import { atom } from 'jotai'

type DocumentDetailLocation = {
  chunk?: string | null
  revision?: number | null
}

type DocumentDetailLocationRuntime = {
  setDocumentLocation: (location: DocumentDetailLocation) => Promise<URLSearchParams>
}

const unavailableLocationRuntime = async () => {
  throw new Error('Document detail location runtime is unavailable')
}

export const documentDetailLocationRuntimeAtom = atom<DocumentDetailLocationRuntime>({
  setDocumentLocation: unavailableLocationRuntime,
})

export const selectDocumentChunkAtom = atom(null, (get, _set, chunkId: string) =>
  get(documentDetailLocationRuntimeAtom).setDocumentLocation({ chunk: chunkId }),
)
