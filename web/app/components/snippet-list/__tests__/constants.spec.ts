import { SNIPPET_LIST_SEARCH_DEBOUNCE_MS } from '../constants'

describe('snippet-list constants', () => {
  it('should keep the snippet search debounce delay at 500ms', () => {
    expect(SNIPPET_LIST_SEARCH_DEBOUNCE_MS).toBe(500)
  })
})
