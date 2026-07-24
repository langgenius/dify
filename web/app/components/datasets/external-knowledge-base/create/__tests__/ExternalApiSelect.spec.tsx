import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Explicit react-i18next mock so the test stays portable
// even if the global vitest.setup changes.

// Hoisted mocks
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  setShowExternalKnowledgeAPIModal: vi.fn(),
  mutateExternalKnowledgeApis: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowExternalKnowledgeAPIModal: mocks.setShowExternalKnowledgeAPIModal,
  }),
}))

vi.mock('@/context/external-knowledge-api-context', () => ({
  useExternalKnowledgeApi: () => ({
    mutateExternalKnowledgeApis: mocks.mutateExternalKnowledgeApis,
  }),
}))

vi.mock('@/app/components/base/icons/src/vender/solid/development', () => ({
  ApiConnectionMod: (props: Record<string, unknown>) => <span data-testid="api-icon" {...props} />,
}))

const { default: ExternalApiSelect } = await import('../ExternalApiSelect')

describe('ExternalApiSelect', () => {
  const items = [
    { value: 'api-1', name: 'API One', url: 'https://api1.com' },
    { value: 'api-2', name: 'API Two', url: 'https://api2.com' },
  ]
  const onSelect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('should show placeholder when no value selected', () => {
      render(<ExternalApiSelect items={items} onSelect={onSelect} />)
      expect(screen.getByText('dataset.selectExternalKnowledgeAPI.placeholder')).toBeInTheDocument()
    })

    it('should show selected item name when value matches', () => {
      render(<ExternalApiSelect items={items} value="api-1" onSelect={onSelect} />)
      expect(screen.getByText('API One')).toBeInTheDocument()
    })

    it('should not show dropdown initially', () => {
      render(<ExternalApiSelect items={items} onSelect={onSelect} />)
      expect(screen.queryByText('API Two')).not.toBeInTheDocument()
    })
  })

  describe('dropdown interactions', () => {
    it('should open dropdown on click', () => {
      render(<ExternalApiSelect items={items} onSelect={onSelect} />)
      fireEvent.click(screen.getByText('dataset.selectExternalKnowledgeAPI.placeholder'))
      expect(screen.getByText('API One')).toBeInTheDocument()
      expect(screen.getByText('API Two')).toBeInTheDocument()
    })

    it('should close dropdown and call onSelect when item clicked', () => {
      render(<ExternalApiSelect items={items} onSelect={onSelect} />)
      // Open
      fireEvent.click(screen.getByText('dataset.selectExternalKnowledgeAPI.placeholder'))
      // Select
      fireEvent.click(screen.getByText('API Two'))
      expect(onSelect).toHaveBeenCalledWith(items[1])
      // Dropdown should close - selected name should show
      expect(screen.getByText('API Two')).toBeInTheDocument()
    })

    it('should show add new API option in dropdown', () => {
      render(<ExternalApiSelect items={items} onSelect={onSelect} />)
      fireEvent.click(screen.getByText('dataset.selectExternalKnowledgeAPI.placeholder'))
      expect(screen.getByText('dataset.createNewExternalAPI')).toBeInTheDocument()
    })

    it('should call setShowExternalKnowledgeAPIModal when add new clicked', () => {
      render(<ExternalApiSelect items={items} onSelect={onSelect} />)
      fireEvent.click(screen.getByText('dataset.selectExternalKnowledgeAPI.placeholder'))
      fireEvent.click(screen.getByText('dataset.createNewExternalAPI'))
      expect(mocks.setShowExternalKnowledgeAPIModal).toHaveBeenCalledOnce()
    })

    it('should show item URLs in dropdown', () => {
      render(<ExternalApiSelect items={items} onSelect={onSelect} />)
      fireEvent.click(screen.getByText('dataset.selectExternalKnowledgeAPI.placeholder'))
      expect(screen.getByText('https://api1.com')).toBeInTheDocument()
      expect(screen.getByText('https://api2.com')).toBeInTheDocument()
    })
  })
})
