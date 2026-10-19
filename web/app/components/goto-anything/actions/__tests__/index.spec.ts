import { createCommandContext } from '../commands/__tests__/context'
import { createSlashAction } from '../commands/slash'
import { createActions, getActionSearchTerm, matchAction } from '../index'

const slash = createSlashAction(createCommandContext())

describe('getActionSearchTerm', () => {
  it('removes either the action key or shortcut', () => {
    const action = createActions(slash, false, false).knowledge

    expect(getActionSearchTerm('@knowledge vector store', action)).toBe('vector store')
    expect(getActionSearchTerm('@kb vector store', action)).toBe('vector store')
  })
})

describe('matchAction', () => {
  const actions = createActions(slash, false, false, { agents: true, skills: true })

  it.each([
    ['@app query', '@app'],
    ['@kb query', '@knowledge'],
    ['@plugin query', '@plugin'],
    ['@skill query', '@skill'],
    ['@agents query', '@agents'],
  ])('matches %s', (query, key) => {
    expect(matchAction(query, actions)?.key).toBe(key)
  })

  it('requires a delimiter before entering a scoped search', () => {
    expect(matchAction('@app', actions)).toBeUndefined()
    expect(matchAction('@app ', actions)?.key).toBe('@app')
  })

  it('requires a delimiter for submenu commands and leaves direct commands in the picker', () => {
    expect(matchAction('/theme', actions)).toBeUndefined()
    expect(matchAction('/theme ', actions)?.key).toBe('/')
    expect(matchAction('/theme dark', actions)?.key).toBe('/')
    expect(matchAction('/lang english', actions)?.key).toBe('/')
    expect(matchAction('/docs', actions)).toBeUndefined()
    expect(matchAction('/the', actions)).toBeUndefined()
  })
})
