import type { App, AppSSO } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import CreateImportSection from './create-import-section'

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

describe('CreateImportSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.existingNames = new Set()
    useAppStore.setState({
      appDetail: { id: 'app-1' } as App & Partial<AppSSO>,
    })
  })

  describe('Rendering', () => {
    it('should render create and import action cards when section is mounted', () => {
      render(<CreateImportSection />)

      expect(screen.getByRole('button', { name: /workflow\.skill\.startTab\.createBlankSkill/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importSkill/i })).toBeInTheDocument()
      expect(screen.queryByText('workflow.skill.startTab.createModal.title')).not.toBeInTheDocument()
      expect(screen.queryByText('workflow.skill.startTab.importModal.title')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should open and close create modal when create action card is clicked', async () => {
      render(<CreateImportSection />)

      fireEvent.click(screen.getByRole('button', { name: /workflow\.skill\.startTab\.createBlankSkill/i }))
      await waitFor(() => {
        expect(screen.getByText('workflow.skill.startTab.createModal.title')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))
      await waitFor(() => {
        expect(screen.queryByText('workflow.skill.startTab.createModal.title')).not.toBeInTheDocument()
      })
    })

    it('should open and close import modal when import action card is clicked', async () => {
      render(<CreateImportSection />)

      fireEvent.click(screen.getByRole('button', { name: /workflow\.skill\.startTab\.importSkill/i }))
      await waitFor(() => {
        expect(screen.getByText('workflow.skill.startTab.importModal.title')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/i }))
      await waitFor(() => {
        expect(screen.queryByText('workflow.skill.startTab.importModal.title')).not.toBeInTheDocument()
      })
    })
  })
})
