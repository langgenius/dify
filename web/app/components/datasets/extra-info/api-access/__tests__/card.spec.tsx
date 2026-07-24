import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Card from '../card'

// Shared mock state for context selectors
let mockDatasetId: string | undefined = 'dataset-123'
let mockMutateDatasetRes: ReturnType<typeof vi.fn> = vi.fn()
let mockIsCurrentWorkspaceManager = true

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      dataset: { id: mockDatasetId },
      mutateDatasetRes: mockMutateDatasetRes,
    }),
}))

vi.mock('@/context/app-context', () => ({
  useSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager }),
}))

const mockEnableApi = vi.fn()
const mockDisableApi = vi.fn()

vi.mock('@/service/knowledge/use-dataset', () => ({
  useEnableDatasetServiceApi: () => ({
    mutateAsync: mockEnableApi,
  }),
  useDisableDatasetServiceApi: () => ({
    mutateAsync: mockDisableApi,
  }),
}))

vi.mock('@/hooks/use-api-access-url', () => ({
  useDatasetApiAccessUrl: () => 'https://docs.dify.ai/api-reference/datasets',
}))

describe('Card (API Access)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasetId = 'dataset-123'
    mockMutateDatasetRes = vi.fn()
    mockIsCurrentWorkspaceManager = true
  })

  // Rendering: verifies enabled/disabled states render correctly
  describe('Rendering', () => {
    it('should render without crashing when api is enabled', () => {
      render(<Card apiEnabled={true} />)
      expect(screen.getByText(/serviceApi\.enabled/)).toBeInTheDocument()
    })

    it('should render without crashing when api is disabled', () => {
      render(<Card apiEnabled={false} />)
      expect(screen.getByText(/serviceApi\.disabled/)).toBeInTheDocument()
    })

    it('should render API access tip text', () => {
      render(<Card apiEnabled={true} />)
      expect(screen.getByText(/appMenus\.apiAccessTip/)).toBeInTheDocument()
    })

    it('should render API reference link', () => {
      render(<Card apiEnabled={true} />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', 'https://docs.dify.ai/api-reference/datasets')
    })

    it('should render API doc text in link', () => {
      render(<Card apiEnabled={true} />)
      expect(screen.getByText(/apiInfo\.doc/)).toBeInTheDocument()
    })

    it('should open API reference link in new tab', () => {
      render(<Card apiEnabled={true} />)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  // Props: tests enabled/disabled visual states
  describe('Props', () => {
    it('should show green indicator text when enabled', () => {
      render(<Card apiEnabled={true} />)
      const enabledText = screen.getByText(/serviceApi\.enabled/)
      expect(enabledText).toHaveClass('text-text-success')
    })

    it('should show warning text when disabled', () => {
      render(<Card apiEnabled={false} />)
      const disabledText = screen.getByText(/serviceApi\.disabled/)
      expect(disabledText).toHaveClass('text-text-warning')
    })
  })

  // User Interactions: tests toggle behavior
  describe('User Interactions', () => {
    it('should call enableDatasetServiceApi when toggling on', async () => {
      mockEnableApi.mockResolvedValue({ result: 'success' })
      render(<Card apiEnabled={false} />)

      const switchButton = screen.getByRole('switch')
      fireEvent.click(switchButton)

      await waitFor(() => {
        expect(mockEnableApi).toHaveBeenCalledWith('dataset-123')
      })
    })

    it('should call disableDatasetServiceApi when toggling off', async () => {
      mockDisableApi.mockResolvedValue({ result: 'success' })
      render(<Card apiEnabled={true} />)

      const switchButton = screen.getByRole('switch')
      fireEvent.click(switchButton)

      await waitFor(() => {
        expect(mockDisableApi).toHaveBeenCalledWith('dataset-123')
      })
    })

    it('should call mutateDatasetRes on successful toggle', async () => {
      mockEnableApi.mockResolvedValue({ result: 'success' })
      render(<Card apiEnabled={false} />)

      const switchButton = screen.getByRole('switch')
      fireEvent.click(switchButton)

      await waitFor(() => {
        expect(mockMutateDatasetRes).toHaveBeenCalled()
      })
    })

    it('should not call mutateDatasetRes when result is not success', async () => {
      mockEnableApi.mockResolvedValue({ result: 'fail' })
      render(<Card apiEnabled={false} />)

      const switchButton = screen.getByRole('switch')
      fireEvent.click(switchButton)

      await waitFor(() => {
        expect(mockEnableApi).toHaveBeenCalled()
      })
      expect(mockMutateDatasetRes).not.toHaveBeenCalled()
    })
  })

  // Switch disabled state
  describe('Switch State', () => {
    it('should disable switch when user is not workspace manager', () => {
      mockIsCurrentWorkspaceManager = false
      render(<Card apiEnabled={true} />)

      const switchButton = screen.getByRole('switch')
      expect(switchButton).toHaveAttribute('aria-checked', 'true')
      // Headless UI Switch uses CSS classes for disabled state, not the disabled attribute
      expect(switchButton).toHaveClass('!cursor-not-allowed', '!opacity-50')
    })

    it('should enable switch when user is workspace manager', () => {
      mockIsCurrentWorkspaceManager = true
      render(<Card apiEnabled={true} />)

      const switchButton = screen.getByRole('switch')
      expect(switchButton).not.toBeDisabled()
    })
  })

  // Edge Cases: tests boundary scenarios
  describe('Edge Cases', () => {
    it('should handle undefined dataset id', async () => {
      mockDatasetId = undefined
      mockEnableApi.mockResolvedValue({ result: 'success' })
      render(<Card apiEnabled={false} />)

      const switchButton = screen.getByRole('switch')
      fireEvent.click(switchButton)

      await waitFor(() => {
        expect(mockEnableApi).toHaveBeenCalledWith('')
      })
    })
  })
})
