import { createParser, parseAsString } from 'nuqs'
import { createQueryGroup } from 'nuqs-jotai'

const documentDetailRevisionParser = createParser<number>({
  parse: (value) => {
    const revision = Number(value)
    return Number.isInteger(revision) && revision > 0 ? revision : null
  },
  serialize: String,
}).withOptions({ history: 'push' })

const documentDetailChunkParser = parseAsString.withOptions({ history: 'replace' })

export const documentDetailQueryGroup = createQueryGroup(
  {
    chunk: documentDetailChunkParser,
    revision: documentDetailRevisionParser,
  },
  { debugLabel: 'documentDetail.location' },
)

export const documentDetailLocationAtoms = documentDetailQueryGroup.fields
