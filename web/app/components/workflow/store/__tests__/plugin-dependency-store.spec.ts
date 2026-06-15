import type { Dependency } from '@/app/components/plugins/types'
import { useStore } from '../../plugin-dependency/store'

describe('Plugin Dependency Store', () => {
  beforeEach(() => {
    useStore.setState({ dependencies: [] })
  })

  describe('Initial State', () => {
    it('should start with empty dependencies', () => {
      expect(useStore.getState().dependencies).toEqual([])
    })
  })

  describe('setDependencies', () => {
    it('should update dependencies list', () => {
      const deps: Dependency[] = [
        { type: 'marketplace', value: { plugin_unique_identifier: 'p1' } },
        { type: 'marketplace', value: { plugin_unique_identifier: 'p2' } },
      ] as Dependency[]

      useStore.getState().setDependencies(deps)
      expect(useStore.getState().dependencies).toEqual(deps)
    })

    it('should replace existing dependencies', () => {
      const dep1: Dependency = { type: 'marketplace', value: { plugin_unique_identifier: 'p1' } } as Dependency
      const dep2: Dependency = { type: 'marketplace', value: { plugin_unique_identifier: 'p2' } } as Dependency
      useStore.getState().setDependencies([dep1])
      useStore.getState().setDependencies([dep2])

      expect(useStore.getState().dependencies).toHaveLength(1)
    })

    it('should handle empty array', () => {
      const dep: Dependency = { type: 'marketplace', value: { plugin_unique_identifier: 'p1' } } as Dependency
      useStore.getState().setDependencies([dep])
      useStore.getState().setDependencies([])

      expect(useStore.getState().dependencies).toEqual([])
    })
  })
})
