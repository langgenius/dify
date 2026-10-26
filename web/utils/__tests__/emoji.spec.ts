import { resolveEmoji } from '../emoji'

describe('persisted emoji compatibility', () => {
  it.each([
    ['rabbit', '🐰'],
    ['robot_face', '🤖'],
    ['satisfied', '😆'],
    [':+1:', '👍'],
    ['🐻', '🐻'],
    ['👩🏽‍💻', '👩🏽‍💻'],
    ['unknown-id', 'unknown-id'],
    ['', '🤖'],
    [undefined, '🤖'],
  ])('resolves %s to %s', (value, expected) => {
    expect(resolveEmoji(value)).toBe(expected)
  })
})
