import { debounce, parseAsString, parseAsStringLiteral } from 'nuqs'

export const myAppsQueryParsers = {
  view: parseAsStringLiteral(['all', 'starred']).withDefault('all'),
  sort: parseAsStringLiteral(['last-used', 'name']).withDefault('last-used'),
  q: parseAsString.withDefault('').withOptions({ limitUrlUpdates: debounce(300) }),
}
