import { namespaces } from '../resources'
import { getInitOptions } from '../settings'

describe('getInitOptions', () => {
  it('uses the full namespace registry by default', () => {
    expect(getInitOptions().ns).toEqual([...namespaces])
  })

  it('limits registered namespaces when an initial subset is provided', () => {
    const subset = ['common', 'app', 'explore'] as const
    const options = getInitOptions({ namespaces: subset })

    expect(options.ns).toEqual([...subset])
    expect(options.ns?.length).toBeLessThan(namespaces.length)
  })
})
