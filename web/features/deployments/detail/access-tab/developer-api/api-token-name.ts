const API_TOKEN_NAME_ADJECTIVES = [
  'ancient',
  'autumn',
  'bright',
  'calm',
  'crystal',
  'gentle',
  'golden',
  'hidden',
  'holy',
  'quiet',
  'rapid',
  'silver',
]

const API_TOKEN_NAME_NOUNS = [
  'brook',
  'cloud',
  'field',
  'forest',
  'harbor',
  'lake',
  'meadow',
  'moon',
  'river',
  'stone',
  'valley',
  'wave',
]

function randomListItem(items: string[]) {
  const item = items[Math.floor(Math.random() * items.length)]
  if (item === undefined)
    throw new Error('Cannot generate an API token name from an empty list.')

  return item
}

export function generateApiTokenName() {
  const suffix = Math.floor(1000 + Math.random() * 9000)

  return `${randomListItem(API_TOKEN_NAME_ADJECTIVES)}-${randomListItem(API_TOKEN_NAME_NOUNS)}-${suffix}`
}
