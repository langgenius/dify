import { resolveEmoji } from '../emoji'

describe('persisted emoji display', () => {
  it.each([
    ['🐻', '🐻'],
    ['👩🏽‍💻', '👩🏽‍💻'],
    ['unknown-id', 'unknown-id'],
    ['', '🤖'],
    [undefined, '🤖'],
  ])('renders %s as %s', (value, expected) => {
    expect(resolveEmoji(value)).toBe(expected)
  })
})
