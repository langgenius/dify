import { atom } from 'jotai'

type DocumentDetailLocation = {
  chunk?: string | null
  revision?: number | null
}

type DocumentDetailLocationRuntime = {
  setDocumentLocation: (location: DocumentDetailLocation) => Promise<URLSearchParams>
}

type DocumentDetailTitleRuntime = {
  focusTitle: () => void
}

const unavailableLocationRuntime = async () => {
  throw new Error('Document detail location runtime is unavailable')
}

export const documentDetailLocationRuntimeAtom = atom<DocumentDetailLocationRuntime>({
  setDocumentLocation: unavailableLocationRuntime,
})

export const documentDetailTitleRuntimeAtom = atom<DocumentDetailTitleRuntime>({
  focusTitle: () => {
    throw new Error('Document detail title runtime is unavailable')
  },
})

export const selectDocumentChunkAtom = atom(null, (get, _set, chunkId: string) =>
  get(documentDetailLocationRuntimeAtom).setDocumentLocation({ chunk: chunkId }),
)

export const focusDocumentDetailTitleAtom = atom(null, (get) => {
  get(documentDetailTitleRuntimeAtom).focusTitle()
})
