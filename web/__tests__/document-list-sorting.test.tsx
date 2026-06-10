/**
 * Document List Sorting Tests
 */

describe('Document List Sorting', () => {
  const mockDocuments = [
    { id: '1', name: 'Beta.pdf', word_count: 500, hit_count: 10, created_at: 1699123456 },
    { id: '2', name: 'Alpha.txt', word_count: 200, hit_count: 25, created_at: 1699123400 },
    { id: '3', name: 'Gamma.docx', word_count: 800, hit_count: 5, created_at: 1699123500 },
  ]

  const sortDocuments = (docs: any[], field: string, order: 'asc' | 'desc') => {
    return [...docs].sort((a, b) => {
      let aValue: any
      let bValue: any

      switch (field) {
        case 'name':
          aValue = a.name?.toLowerCase() || ''
          bValue = b.name?.toLowerCase() || ''
          break
        case 'word_count':
          aValue = a.word_count || 0
          bValue = b.word_count || 0
          break
        case 'hit_count':
          aValue = a.hit_count || 0
          bValue = b.hit_count || 0
          break
        case 'created_at':
          aValue = a.created_at
          bValue = b.created_at
          break
        default:
          return 0
      }

      if (field === 'name') {
        const result = aValue.localeCompare(bValue)
        return order === 'asc' ? result : -result
      }
      else {
        const result = aValue - bValue
        return order === 'asc' ? result : -result
      }
    })
  }

  it('sorts by name descending (default for UI consistency)', () => {
    const sorted = sortDocuments(mockDocuments, 'name', 'desc')
    expect(sorted.map(doc => doc.name)).toEqual(['Gamma.docx', 'Beta.pdf', 'Alpha.txt'])
  })

  it('sorts by name ascending (after toggle)', () => {
    const sorted = sortDocuments(mockDocuments, 'name', 'asc')
    expect(sorted.map(doc => doc.name)).toEqual(['Alpha.txt', 'Beta.pdf', 'Gamma.docx'])
  })

  it('sorts by word_count descending', () => {
    const sorted = sortDocuments(mockDocuments, 'word_count', 'desc')
    expect(sorted.map(doc => doc.word_count)).toEqual([800, 500, 200])
  })

  it('sorts by hit_count descending', () => {
    const sorted = sortDocuments(mockDocuments, 'hit_count', 'desc')
    expect(sorted.map(doc => doc.hit_count)).toEqual([25, 10, 5])
  })

  it('sorts by created_at descending (newest first)', () => {
    const sorted = sortDocuments(mockDocuments, 'created_at', 'desc')
    expect(sorted.map(doc => doc.created_at)).toEqual([1699123500, 1699123456, 1699123400])
  })

  it('handles empty values correctly', () => {
    const docsWithEmpty = [
      { id: '1', name: 'Test', word_count: 100, hit_count: 5, created_at: 1699123456 },
      { id: '2', name: 'Empty', word_count: 0, hit_count: 0, created_at: 1699123400 },
    ]

    const sorted = sortDocuments(docsWithEmpty, 'word_count', 'desc')
    expect(sorted.map(doc => doc.word_count)).toEqual([100, 0])
  })
})
