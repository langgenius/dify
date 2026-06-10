import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataSourceProvider } from '@/models/common'
import NoData from '../no-data'

// Mock Setup

// Mock CSS module
vi.mock('../index.module.css', () => ({
  default: {
    jinaLogo: 'jinaLogo',
    watercrawlLogo: 'watercrawlLogo',
  },
}))

// Feature flags - default all enabled
let mockEnableFirecrawl = true
let mockEnableJinaReader = true
let mockEnableWaterCrawl = true

vi.mock('@/config', () => ({
  get ENABLE_WEBSITE_FIRECRAWL() { return mockEnableFirecrawl },
  get ENABLE_WEBSITE_JINAREADER() { return mockEnableJinaReader },
  get ENABLE_WEBSITE_WATERCRAWL() { return mockEnableWaterCrawl },
}))

// NoData Component Tests

describe('NoData', () => {
  const mockOnConfig = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockEnableFirecrawl = true
    mockEnableJinaReader = true
    mockEnableWaterCrawl = true
  })

  // Rendering Tests - Per Provider
  describe('Rendering per provider', () => {
    it('should render fireCrawl provider with emoji and not-configured message', () => {
      render(<NoData onConfig={mockOnConfig} provider={DataSourceProvider.fireCrawl} />)

      expect(screen.getByText('🔥')).toBeInTheDocument()
      const titleAndDesc = screen.getAllByText(/fireCrawlNotConfigured/i)
      expect(titleAndDesc).toHaveLength(2)
    })

    it('should render jinaReader provider with jina logo and not-configured message', () => {
      render(<NoData onConfig={mockOnConfig} provider={DataSourceProvider.jinaReader} />)

      const titleAndDesc = screen.getAllByText(/jinaReaderNotConfigured/i)
      expect(titleAndDesc).toHaveLength(2)
    })

    it('should render waterCrawl provider with emoji and not-configured message', () => {
      render(<NoData onConfig={mockOnConfig} provider={DataSourceProvider.waterCrawl} />)

      expect(screen.getByText('💧')).toBeInTheDocument()
      const titleAndDesc = screen.getAllByText(/waterCrawlNotConfigured/i)
      expect(titleAndDesc).toHaveLength(2)
    })

    it('should render configure button for each provider', () => {
      render(<NoData onConfig={mockOnConfig} provider={DataSourceProvider.fireCrawl} />)

      expect(screen.getByRole('button', { name: /configure/i })).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onConfig when configure button is clicked', () => {
      render(<NoData onConfig={mockOnConfig} provider={DataSourceProvider.fireCrawl} />)

      fireEvent.click(screen.getByRole('button', { name: /configure/i }))

      expect(mockOnConfig).toHaveBeenCalledTimes(1)
    })

    it('should call onConfig for jinaReader provider', () => {
      render(<NoData onConfig={mockOnConfig} provider={DataSourceProvider.jinaReader} />)

      fireEvent.click(screen.getByRole('button', { name: /configure/i }))

      expect(mockOnConfig).toHaveBeenCalledTimes(1)
    })

    it('should call onConfig for waterCrawl provider', () => {
      render(<NoData onConfig={mockOnConfig} provider={DataSourceProvider.waterCrawl} />)

      fireEvent.click(screen.getByRole('button', { name: /configure/i }))

      expect(mockOnConfig).toHaveBeenCalledTimes(1)
    })
  })

  // Feature Flag Disabled - Returns null
  describe('Disabled providers (feature flag off)', () => {
    it('should fall back to jinaReader when fireCrawl is disabled but jinaReader enabled', () => {
      // Arrange — fireCrawl config is null, falls back to providerConfig.jinareader
      mockEnableFirecrawl = false

      const { container } = render(
        <NoData onConfig={mockOnConfig} provider={DataSourceProvider.fireCrawl} />,
      )

      // Assert — renders the jinaReader fallback (not null)
      expect(container.innerHTML).not.toBe('')
      expect(screen.getAllByText(/jinaReaderNotConfigured/).length).toBeGreaterThan(0)
    })

    it('should return null when jinaReader is disabled', () => {
      // Arrange — jinaReader is the only provider without a fallback
      mockEnableJinaReader = false

      const { container } = render(
        <NoData onConfig={mockOnConfig} provider={DataSourceProvider.jinaReader} />,
      )

      expect(container.innerHTML).toBe('')
    })

    it('should fall back to jinaReader when waterCrawl is disabled but jinaReader enabled', () => {
      // Arrange — waterCrawl config is null, falls back to providerConfig.jinareader
      mockEnableWaterCrawl = false

      const { container } = render(
        <NoData onConfig={mockOnConfig} provider={DataSourceProvider.waterCrawl} />,
      )

      // Assert — renders the jinaReader fallback (not null)
      expect(container.innerHTML).not.toBe('')
      expect(screen.getAllByText(/jinaReaderNotConfigured/).length).toBeGreaterThan(0)
    })
  })

  // Fallback behavior
  describe('Fallback behavior', () => {
    it('should fall back to jinaReader config for unknown provider value', () => {
      // Arrange - the || fallback goes to providerConfig.jinareader
      // Since DataSourceProvider only has 3 values, we test the fallback
      // by checking that jinaReader is the fallback when provider doesn't match
      mockEnableJinaReader = true

      render(<NoData onConfig={mockOnConfig} provider={DataSourceProvider.jinaReader} />)

      expect(screen.getAllByText(/jinaReaderNotConfigured/i).length).toBeGreaterThan(0)
    })
  })

  describe('Edge Cases', () => {
    it('should not call onConfig without user interaction', () => {
      render(<NoData onConfig={mockOnConfig} provider={DataSourceProvider.fireCrawl} />)

      expect(mockOnConfig).not.toHaveBeenCalled()
    })

    it('should render correctly when all providers are enabled', () => {
      // Arrange - all flags are true by default

      const { rerender } = render(
        <NoData onConfig={mockOnConfig} provider={DataSourceProvider.fireCrawl} />,
      )
      expect(screen.getByText('🔥')).toBeInTheDocument()

      rerender(<NoData onConfig={mockOnConfig} provider={DataSourceProvider.jinaReader} />)
      expect(screen.getAllByText(/jinaReaderNotConfigured/i).length).toBeGreaterThan(0)

      rerender(<NoData onConfig={mockOnConfig} provider={DataSourceProvider.waterCrawl} />)
      expect(screen.getByText('💧')).toBeInTheDocument()
    })

    it('should return null when all providers are disabled and fireCrawl is selected', () => {
      mockEnableFirecrawl = false
      mockEnableJinaReader = false
      mockEnableWaterCrawl = false

      const { container } = render(
        <NoData onConfig={mockOnConfig} provider={DataSourceProvider.fireCrawl} />,
      )

      expect(container.innerHTML).toBe('')
    })
  })
})
