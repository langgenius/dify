import type { App, AppSSO } from '@/types/app'
import { render, screen } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import StartTabContent from './index'

type MockWorkflowState = {
  setUploadStatus: ReturnType<typeof vi.fn>
  setUploadProgress: ReturnType<typeof vi.fn>
  openTab: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  existingNames: new Set<string>(),
  emitTreeUpdate: vi.fn(),
  workflowState: {
    setUploadStatus: vi.fn(),
    setUploadProgress: vi.fn(),
    openTab: vi.fn(),
  } as MockWorkflowState,
}))

vi.mock('@/service/use-app-asset', () => ({
  useBatchUpload: () => ({
    mutateAsync: mocks.mutateAsync,
  }),
}))

vi.mock('../hooks/file-tree/data/use-skill-asset-tree', () => ({
  useExistingSkillNames: () => ({
    data: mocks.existingNames,
  }),
}))

vi.mock('../hooks/file-tree/data/use-skill-tree-collaboration', () => ({
  useSkillTreeUpdateEmitter: () => mocks.emitTreeUpdate,
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => mocks.workflowState,
  }),
}))

describe('StartTabContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.existingNames = new Set()
    useAppStore.setState({
      appDetail: { id: 'app-1' } as App & Partial<AppSSO>,
    })
  })

  describe('Rendering', () => {
    it('should render create/import actions and template list when mounted', () => {
      const { container } = render(<StartTabContent />)

      expect(screen.getByRole('button', { name: /workflow\.skill\.startTab\.createBlankSkill/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importSkill/i })).toBeInTheDocument()
      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(screen.getByText('workflow.skill.startTab.templatesTitle')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /workflow\.skill\.startTab\.useThisSkill/i }).length).toBeGreaterThan(0)
      expect(container.firstChild).toHaveClass('flex', 'h-full', 'w-full', 'bg-components-panel-bg')
    })
  })
})
