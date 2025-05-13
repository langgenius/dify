import { defaultSystemFeatures } from '@/types/feature'
import { renderHook } from '@testing-library/react'
import useDocumentTitle from './use-document-title'

jest.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: jest.fn(() => ({ ...defaultSystemFeatures })),
}))

describe('branding.enabled is false', () => {
  it('document title should be test-Dify if set title', () => {
    renderHook(() => useDocumentTitle('test'))
    expect(document.title).toBe('test - Dify')
  })

  it('document title should be Dify if not set title', () => {
    renderHook(() => useDocumentTitle(''))
    expect(document.title).toBe('Dify')
  })
})
