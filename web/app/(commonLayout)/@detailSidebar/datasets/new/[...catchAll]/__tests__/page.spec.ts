import NewKnowledgeDetailSidebar from '../page'

describe('New Knowledge detail sidebar slot', () => {
  it('clears the legacy dataset sidebar during soft navigation', () => {
    expect(NewKnowledgeDetailSidebar()).toBeNull()
  })
})
