import { CollectionType } from '@/app/components/tools/types'
import { isToolAuthorizationRequired } from '../auth'

describe('isToolAuthorizationRequired', () => {
  it('should return true for built-in tools that require authorization and are not authorized', () => {
    expect(isToolAuthorizationRequired(CollectionType.builtIn, {
      allow_delete: true,
      is_team_authorization: false,
    })).toBe(true)
  })

  it('should return false when the built-in tool is already authorized', () => {
    expect(isToolAuthorizationRequired(CollectionType.builtIn, {
      allow_delete: true,
      is_team_authorization: true,
    })).toBe(false)
  })

  it('should return false for non-built-in tools even if the provider is unauthorized', () => {
    expect(isToolAuthorizationRequired(CollectionType.custom, {
      allow_delete: true,
      is_team_authorization: false,
    })).toBe(false)
  })

  it('should return false when the collection is missing or authorization is not required', () => {
    expect(isToolAuthorizationRequired(CollectionType.builtIn)).toBe(false)
    expect(isToolAuthorizationRequired(CollectionType.builtIn, {
      allow_delete: false,
      is_team_authorization: false,
    })).toBe(false)
  })
})
