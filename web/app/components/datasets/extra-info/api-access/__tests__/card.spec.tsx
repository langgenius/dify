import { Popover } from '@langgenius/dify-ui/popover'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatasetACLPermission } from '@/utils/permission'
import Card from '../card'

// Shared mock state for context selectors
let mockDatasetId: string | undefined = 'dataset-123'
let mockMutateDatasetRes: ReturnType<typeof vi.fn> = vi.fn()
let mockDatasetPermissionKeys: string[] = [DatasetACLPermission.Edit]

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      dataset: { id: mockDatasetId, permission_keys: mockDatasetPermissionKeys },
      mutateDatasetRes: mockMutateDatasetRes,
    }),
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

const onOpenSecretKeyModal = vi.fn()

// Card renders a PopoverClose, which needs an enclosing Popover root.
const renderCard = (apiEnabled: boolean) =>
  render(
    <Popover open>
      <Card apiEnabled={apiEnabled} onOpenSecretKeyModal={onOpenSecretKeyModal} />
    </Popover>,
  )

describe('Card (API Access)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasetId = 'dataset-123'
    mockMutateDatasetRes = vi.fn()
    mockDatasetPermissionKeys = [DatasetACLPermission.Edit]
  })

  // Rendering: verifies enabled/disabled states render correctly
  describe('Rendering', () => {
    it('should render without crashing when api is enabled', () => {
      renderCard(true)
      expect(screen.getByText(/serviceApi\.enabled/)).toBeInTheDocument()
    })

    it('should render without crashing when api is disabled', () => {
      renderCard(false)
      expect(screen.getByText(/serviceApi\.disabled/)).toBeInTheDocument()
    })

    it('should render API access tip text', () => {
      renderCard(true)
      expect(screen.getByText(/appMenus\.apiAccessTip/)).toBeInTheDocument()
    })

    it('should render API reference link', () => {
      renderCard(true)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', 'https://docs.dify.ai/api-reference/datasets')
    })

    it('should render API doc text in link', () => {
      renderCard(true)
      expect(screen.getByText(/apiInfo\.doc/)).toBeInTheDocument()
    })

    it('should open API reference link in new tab', () => {
      renderCard(true)
      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  // Props: tests enabled/disabled visual states
  describe('Props', () => {
    it('should show green indicator text when enabled', () => {
      renderCard(true)
      const enabledText = screen.getByText(/serviceApi\.enabled/)
      expect(enabledText).toHaveClass('text-text-success')
    })

    it('should show warning text when disabled', () => {
      renderCard(false)
      const disabledText = screen.getByText(/serviceApi\.disabled/)
      expect(disabledText).toHaveClass('text-text-warning')
    })
  })

  // User Interactions: tests toggle behavior
  describe('User Interactions', () => {
    it('should call enableDatasetServiceApi when toggling on', async () => {
      mockEnableApi.mockResolvedValue({ result: 'success' })
      renderCard(false)

      const switchButton = screen.getByRole('switch')
      fireEvent.click(switchButton)

      await waitFor(() => {
        expect(mockEnableApi).toHaveBeenCalledWith('dataset-123')
      })
    })

    it('should call disableDatasetServiceApi when toggling off', async () => {
      mockDisableApi.mockResolvedValue({ result: 'success' })
      renderCard(true)

      const switchButton = screen.getByRole('switch')
      fireEvent.click(switchButton)

      await waitFor(() => {
        expect(mockDisableApi).toHaveBeenCalledWith('dataset-123')
      })
    })

    it('should call mutateDatasetRes on successful toggle', async () => {
      mockEnableApi.mockResolvedValue({ result: 'success' })
      renderCard(false)

      const switchButton = screen.getByRole('switch')
      fireEvent.click(switchButton)

      await waitFor(() => {
        expect(mockMutateDatasetRes).toHaveBeenCalled()
      })
    })

    it('should not call mutateDatasetRes when result is not success', async () => {
      mockEnableApi.mockResolvedValue({ result: 'fail' })
      renderCard(false)

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
    it('should disable switch when dataset lacks edit ACL permission', () => {
      mockDatasetPermissionKeys = []
      renderCard(true)

      const switchButton = screen.getByRole('switch')
      expect(switchButton).toHaveAttribute('aria-checked', 'true')
      expect(switchButton).toHaveAttribute('aria-disabled', 'true')
    })

    it('should enable switch when dataset has edit ACL permission', () => {
      mockDatasetPermissionKeys = [DatasetACLPermission.Edit]
      renderCard(true)

      const switchButton = screen.getByRole('switch')
      expect(switchButton).not.toHaveAttribute('aria-disabled', 'true')
    })
  })

  // API keys entry point
  describe('API Keys Button', () => {
    it('should render the API key action', () => {
      renderCard(true)
      expect(screen.getByText(/serviceApi\.card\.apiKey/)).toBeInTheDocument()
    })

    it('should call onOpenSecretKeyModal when the API key action is clicked', () => {
      renderCard(true)
      fireEvent.click(screen.getByText(/serviceApi\.card\.apiKey/))
      expect(onOpenSecretKeyModal).toHaveBeenCalledTimes(1)
    })
  })

  // Edge Cases: tests boundary scenarios
  describe('Edge Cases', () => {
    it('should handle undefined dataset id', async () => {
      mockDatasetId = undefined
      mockEnableApi.mockResolvedValue({ result: 'success' })
      renderCard(false)

      const switchButton = screen.getByRole('switch')
      fireEvent.click(switchButton)

      await waitFor(() => {
        expect(mockEnableApi).toHaveBeenCalledWith('')
      })
    })
  })
})
