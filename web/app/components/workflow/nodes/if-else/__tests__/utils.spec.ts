import { branchNameCorrect } from '../utils'

describe('branchNameCorrect', () => {
  it('keeps missing or incomplete branch lists intact for validation', () => {
    expect(branchNameCorrect([])).toEqual([])
    expect(branchNameCorrect([{ id: 'true', name: 'Imported branch' }])).toEqual([
      { id: 'true', name: 'Imported branch' },
    ])
  })

  it('labels a lone false branch ELSE', () => {
    expect(branchNameCorrect([{ id: 'false', name: '' }])).toEqual([{ id: 'false', name: 'ELSE' }])
  })

  it('labels the two branches of an ordinary IF and ELSE', () => {
    expect(
      branchNameCorrect([
        { id: 'true', name: '' },
        { id: 'false', name: '' },
      ]),
    ).toEqual([
      { id: 'true', name: 'IF' },
      { id: 'false', name: 'ELSE' },
    ])
  })

  it('numbers multiple conditional branches and labels the final ELSE', () => {
    expect(
      branchNameCorrect([
        { id: 'true', name: '' },
        { id: 'second-case', name: '' },
        { id: 'false', name: '' },
      ]),
    ).toEqual([
      { id: 'true', name: 'CASE 1' },
      { id: 'second-case', name: 'CASE 2' },
      { id: 'false', name: 'ELSE' },
    ])
  })
})
