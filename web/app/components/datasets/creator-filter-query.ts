import { createParser } from 'nuqs'

export const CREATOR_FILTER_MAX_ID_LENGTH = 255
export const CREATOR_FILTER_MAX_SELECTION = 100

const normalizeCreatorIds = (creatorIds: string[]) => {
  return [...new Set(creatorIds)]
    .filter((creatorId) => creatorId.length > 0 && creatorId.length <= CREATOR_FILTER_MAX_ID_LENGTH)
    .slice(0, CREATOR_FILTER_MAX_SELECTION)
}

export const creatorIdsParser = createParser<string[]>({
  eq: (left, right) =>
    left.length === right.length && left.every((creatorId, index) => creatorId === right[index]),
  parse: (query) => normalizeCreatorIds(query.split(';')),
  serialize: (creatorIds) => normalizeCreatorIds(creatorIds).join(';'),
})
  .withDefault([])
  .withOptions({ history: 'push' })
