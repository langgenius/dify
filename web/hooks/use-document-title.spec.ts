/**
 * Test suite for useDocumentTitle hook
 *
 * This hook manages the browser document title with support for:
 * - Custom branding (when enabled in system features)
 * - Default "Dify" branding
 * - Pending state handling (prevents title flicker during loading)
 * - Page-specific titles with automatic suffix
 *
 * Title format: "[Page Title] - [Brand Name]"
 * If no page title: "[Brand Name]"
 */
import { defaultSystemFeatures } from '@/types/feature'
import { act, renderHook } from '@testing-library/react'
import useDocumentTitle from './use-document-title'
import { useGlobalPublicStore } from '@/context/global-public-context'

jest.mock('@/service/common', () => ({
  getSystemFeatures: jest.fn(() => ({ ...defaultSystemFeatures })),
}))

/**
 * Test behavior when system features are still loading
 * Title should remain empty to prevent flicker
 */
describe('title should be empty if systemFeatures is pending', () => {
  act(() => {
    useGlobalPublicStore.setState({
      systemFeatures: { ...defaultSystemFeatures, branding: { ...defaultSystemFeatures.branding, enabled: false } },
      isGlobalPending: true,
    })
  })
  /**
   * Test that title stays empty during loading even when a title is provided
   */
  it('document title should be empty if set title', () => {
    renderHook(() => useDocumentTitle('test'))
    expect(document.title).toBe('')
  })
  /**
   * Test that title stays empty during loading when no title is provided
   */
  it('document title should be empty if not set title', () => {
    renderHook(() => useDocumentTitle(''))
    expect(document.title).toBe('')
  })
})

/**
 * Test default Dify branding behavior
 * When custom branding is disabled, should use "Dify" as the brand name
 */
describe('use default branding', () => {
  beforeEach(() => {
    act(() => {
      useGlobalPublicStore.setState({
        isGlobalPending: false,
        systemFeatures: { ...defaultSystemFeatures, branding: { ...defaultSystemFeatures.branding, enabled: false } },
      })
    })
  })
  /**
   * Test title format with page title and default branding
   * Format: "[page] - Dify"
   */
  it('document title should be test-Dify if set title', () => {
    renderHook(() => useDocumentTitle('test'))
    expect(document.title).toBe('test - Dify')
  })

  /**
   * Test title with only default branding (no page title)
   * Format: "Dify"
   */
  it('document title should be Dify if not set title', () => {
    renderHook(() => useDocumentTitle(''))
    expect(document.title).toBe('Dify')
  })
})

/**
 * Test custom branding behavior
 * When custom branding is enabled, should use the configured application_title
 */
describe('use specific branding', () => {
  beforeEach(() => {
    act(() => {
      useGlobalPublicStore.setState({
        isGlobalPending: false,
        systemFeatures: { ...defaultSystemFeatures, branding: { ...defaultSystemFeatures.branding, enabled: true, application_title: 'Test' } },
      })
    })
  })
  /**
   * Test title format with page title and custom branding
   * Format: "[page] - [Custom Brand]"
   */
  it('document title should be test-Test if set title', () => {
    renderHook(() => useDocumentTitle('test'))
    expect(document.title).toBe('test - Test')
  })

  /**
   * Test title with only custom branding (no page title)
   * Format: "[Custom Brand]"
   */
  it('document title should be Test if not set title', () => {
    renderHook(() => useDocumentTitle(''))
    expect(document.title).toBe('Test')
  })
})
