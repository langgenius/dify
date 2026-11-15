import { renderHook } from '@testing-library/react'
import useCheckMetadataName from '../use-check-metadata-name'

describe('metadata names', () => {
  it.each(['a', 'name123', 'name_with_underscore', 'a'.repeat(255)])(
    'accepts a valid name (%s)',
    (name) => {
      const { result } = renderHook(() => useCheckMetadataName())
      expect(result.current.checkName(name).errorMsg).toBe('')
    },
  )

  it.each([
    ' ',
    '1name',
    '_name',
    'nameWithUppercase',
    'my name',
    'name-with-dash',
    'name.with.dot',
    '名字',
    'name😀',
  ])('explains the invalid pattern for %s', (name) => {
    const { result } = renderHook(() => useCheckMetadataName())
    expect(result.current.checkName(name).errorMsg).toBe('dataset.metadata.checkName.invalid')
  })

  it('distinguishes a missing name from one over the length limit', () => {
    const { result } = renderHook(() => useCheckMetadataName())
    expect(result.current.checkName('').errorMsg).toBe('dataset.metadata.checkName.empty')
    expect(result.current.checkName('a'.repeat(256)).errorMsg).toContain(
      'dataset.metadata.checkName.tooLong',
    )
  })
})
