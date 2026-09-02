import { createParser, parseAsString } from 'nuqs'
import { createQueryAtoms } from 'nuqs-jotai'

export const documentDetailRevisionParser = createParser<number>({
  parse: (value) => {
    const revision = Number(value)
    return Number.isInteger(revision) && revision > 0 ? revision : null
  },
  serialize: String,
}).withOptions({ history: 'push' })

export const documentDetailChunkParser = parseAsString.withOptions({ history: 'replace' })

export const documentDetailLocationQuery = createQueryAtoms(
  {
    chunk: documentDetailChunkParser,
    revision: documentDetailRevisionParser,
  },
  { debugLabel: 'documentDetail.location' },
)
