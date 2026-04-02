import { TABLES_QUERY } from '../constants'

describe('sqlite constants', () => {
  it('should expose the table listing query', () => {
    expect(TABLES_QUERY).toBe('SELECT name FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name')
  })
})
