import { createParser, parseAsString } from 'nuqs'
import { atomsWithSearchParams } from 'nuqs-jotai'

const documentDetailRevisionParser = createParser<number>({
  parse: (value) => {
    const revision = Number(value)
    return Number.isInteger(revision) && revision > 0 ? revision : null
  },
  serialize: String,
}).withOptions({ history: 'push' })

const documentDetailChunkParser = parseAsString.withOptions({ history: 'replace' })

export const documentDetailLocationAtoms = atomsWithSearchParams(
  {
    chunk: documentDetailChunkParser,
    revision: documentDetailRevisionParser,
  },
  { debugLabel: 'documentDetail.location' },
)
