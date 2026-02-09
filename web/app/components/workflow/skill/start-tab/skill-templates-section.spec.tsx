import type { App, AppSSO } from '@/types/app'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useStore as useAppStore } from '@/app/components/app/store'
import SkillTemplatesSection from './skill-templates-section'

type MockWorkflowState = {
  setUploadStatus: ReturnType<typeof vi.fn>
  setUploadProgress: ReturnType<typeof vi.fn>
}

type TemplateEntry = {
  id: string
  name: string
  description: string
  fileCount: number
  loadContent: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  templates: [] as TemplateEntry[],
  buildUploadDataFromTemplate: vi.fn(),
  mutateAsync: vi.fn(),
  emitTreeUpdate: vi.fn(),
  existingNames: new Set<string>(),
  workflowState: {
    setUploadStatus: vi.fn(),
    setUploadProgress: vi.fn(),
  } as MockWorkflowState,
}))

vi.mock('./templates/registry', () => ({
  SKILL_TEMPLATES: mocks.templates,
}))

vi.mock('./templates/template-to-upload', () => ({
  buildUploadDataFromTemplate: (...args: unknown[]) => mocks.buildUploadDataFromTemplate(...args),
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

const createTemplate = (overrides: Partial<TemplateEntry> = {}): TemplateEntry => ({
  id: 'alpha',
  name: 'alpha',
  description: 'first template',
  fileCount: 2,
  loadContent: vi.fn().mockResolvedValue([
    { name: 'SKILL.md', node_type: 'file', content: '# alpha' },
  ]),
  ...overrides,
})

describe('SkillTemplatesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.templates.length = 0
    mocks.templates.push(
      createTemplate(),
      createTemplate({
        id: 'beta',
        name: 'beta',
        description: 'design template',
        fileCount: 3,
      }),
    )
    mocks.existingNames = new Set()
    mocks.buildUploadDataFromTemplate.mockResolvedValue({
      tree: [{ name: 'alpha', node_type: 'folder', children: [] }],
      files: new Map([['alpha/SKILL.md', new File(['content'], 'SKILL.md')]]),
    })
    mocks.mutateAsync.mockResolvedValue([])
    useAppStore.setState({
      appDetail: { id: 'app-1' } as App & Partial<AppSSO>,
    })
  })

  describe('Rendering', () => {
    it('should render all templates from registry', () => {
      render(<SkillTemplatesSection />)

      expect(screen.getByText('alpha')).toBeInTheDocument()
      expect(screen.getByText('beta')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /workflow\.skill\.startTab\.useThisSkill/i })).toHaveLength(2)
    })

    it('should render empty state when search query has no matches', async () => {
      render(<SkillTemplatesSection />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unknown-template' } })

      await waitFor(() => {
        expect(screen.getByText('workflow.skill.startTab.noTemplatesFound')).toBeInTheDocument()
      }, { timeout: 1500 })
    })
  })

  describe('Template States', () => {
    it('should mark template as added when it exists in current skill names', () => {
      mocks.existingNames = new Set(['alpha'])
      render(<SkillTemplatesSection />)

      expect(screen.getByRole('button', { name: /workflow\.skill\.startTab\.skillAdded/i })).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /workflow\.skill\.startTab\.useThisSkill/i })).toHaveLength(1)
    })
  })

  describe('Use Template Flow', () => {
    it('should upload template and update workflow status when use action succeeds', async () => {
      mocks.mutateAsync.mockImplementationOnce(async ({ onProgress }: { onProgress?: (uploaded: number, total: number) => void }) => {
        onProgress?.(1, 1)
        return []
      })
      render(<SkillTemplatesSection />)

      fireEvent.click(screen.getAllByRole('button', { name: /workflow\.skill\.startTab\.useThisSkill/i })[0])

      await waitFor(() => {
        expect(mocks.mutateAsync).toHaveBeenCalledTimes(1)
      })

      expect(mocks.buildUploadDataFromTemplate).toHaveBeenCalledWith('alpha', expect.any(Array))
      expect(mocks.workflowState.setUploadStatus).toHaveBeenNthCalledWith(1, 'uploading')
      expect(mocks.workflowState.setUploadStatus).toHaveBeenNthCalledWith(2, 'success')
      expect(mocks.workflowState.setUploadProgress).toHaveBeenCalledWith({ uploaded: 0, total: 1, failed: 0 })
      expect(mocks.workflowState.setUploadProgress).toHaveBeenCalledWith({ uploaded: 1, total: 1, failed: 0 })
      expect(mocks.emitTreeUpdate).toHaveBeenCalledTimes(1)
    })

    it('should set partial error when upload fails', async () => {
      mocks.mutateAsync.mockRejectedValueOnce(new Error('upload failed'))
      render(<SkillTemplatesSection />)

      fireEvent.click(screen.getAllByRole('button', { name: /workflow\.skill\.startTab\.useThisSkill/i })[0])

      await waitFor(() => {
        expect(mocks.workflowState.setUploadStatus).toHaveBeenCalledWith('partial_error')
      })
    })

    it('should not start upload when app id is missing', () => {
      useAppStore.setState({ appDetail: undefined })
      render(<SkillTemplatesSection />)

      fireEvent.click(screen.getAllByRole('button', { name: /workflow\.skill\.startTab\.useThisSkill/i })[0])

      expect(mocks.templates[0].loadContent).not.toHaveBeenCalled()
      expect(mocks.mutateAsync).not.toHaveBeenCalled()
      expect(mocks.workflowState.setUploadStatus).not.toHaveBeenCalled()
    })
  })
})
