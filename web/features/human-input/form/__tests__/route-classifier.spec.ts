import { classifyHumanInputFormRoute } from '../route-classifier'

describe('classifyHumanInputFormRoute', () => {
  it.each([
    ['/form/legacy-token', { kind: 'legacy', token: 'legacy-token' }],
    ['/form/legacy-token/', { kind: 'legacy', token: 'legacy-token' }],
    ['/base/form/legacy-token', { kind: 'legacy', token: 'legacy-token' }],
    ['/form-v2/v2-token', { kind: 'v2', token: 'v2-token' }],
    ['/base/form-v2/v2-token/', { kind: 'v2', token: 'v2-token' }],
  ])('classifies %s', (pathname, expected) => {
    expect(classifyHumanInputFormRoute(pathname)).toEqual(expected)
  })

  it.each([
    '/form',
    '/form-v2',
    '/form/token/extra',
    '/form-v2/token/extra',
    '/forms/token',
    '/chat/token',
    '/',
  ])('does not classify malformed or unrelated path %s', (pathname) => {
    expect(classifyHumanInputFormRoute(pathname)).toEqual({ kind: 'non-form' })
  })
})
