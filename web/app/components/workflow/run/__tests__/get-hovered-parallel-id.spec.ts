import { getHoveredParallelId } from '../get-hovered-parallel-id'

describe('getHoveredParallelId', () => {
  it('returns the closest parallel id from the related target', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-parallel-id', 'parallel-1')
    const child = document.createElement('span')
    wrapper.appendChild(child)

    expect(getHoveredParallelId(child)).toBe('parallel-1')
  })

  it('returns null when there is no parallel ancestor', () => {
    expect(getHoveredParallelId(document.createElement('span'))).toBeNull()
    expect(getHoveredParallelId(null)).toBeNull()
  })
})
