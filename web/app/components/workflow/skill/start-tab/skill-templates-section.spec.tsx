import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SkillTemplatesSection from './skill-templates-section'

type TemplateEntry = {
  id: string
  name: string
  description: string
  fileCount: number
  loadContent: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  appId: 'app-1',
  templates: [] as TemplateEntry[],
  buildUploadDataFromTemplate: vi.fn(),
  startUpload: vi.fn(),
  failUpload: vi.fn(),
  uploadTree: vi.fn(),
  existingNames: new Set<string>(),
}))

vi.mock('./templates/registry', () => ({
  SKILL_TEMPLATES: mocks.templates,
}))

vi.mock('./templates/template-to-upload', () => ({
  buildUploadDataFromTemplate: (...args: unknown[]) => mocks.buildUploadDataFromTemplate(...args),
}))

vi.mock('../hooks/file-tree/data/use-skill-asset-tree', () => ({
  useExistingSkillNames: () => ({
    data: mocks.existingNames,
  }),
}))

vi.mock('./use-skill-batch-upload', () => ({
  useSkillBatchUpload: () => ({
    appId: mocks.appId,
    startUpload: mocks.startUpload,
    failUpload: mocks.failUpload,
    uploadTree: mocks.uploadTree,
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
    mocks.uploadTree.mockResolvedValue([])
    mocks.appId = 'app-1'
  })

  describe('Rendering', () => {
    it('should render all templates from registry', () => {
      const { container } = render(<SkillTemplatesSection />)

      expect(screen.getByText('alpha')).toBeInTheDocument()
      expect(screen.getByText('beta')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /workflow\.skill\.startTab\.useThisSkill/i })).toHaveLength(2)
      expect(container.querySelector('.sticky.top-0')).not.toBeNull()
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
    it('should upload template when use action succeeds', async () => {
      render(<SkillTemplatesSection />)

      fireEvent.click(screen.getAllByRole('button', { name: /workflow\.skill\.startTab\.useThisSkill/i })[0])

      await waitFor(() => {
        expect(mocks.uploadTree).toHaveBeenCalledTimes(1)
      })

      expect(mocks.buildUploadDataFromTemplate).toHaveBeenCalledWith('alpha', expect.any(Array))
      expect(mocks.startUpload).toHaveBeenCalledWith(1)
      const uploadArg = mocks.uploadTree.mock.calls[0][0]
      expect(uploadArg.tree).toEqual([{ name: 'alpha', node_type: 'folder', children: [] }])
      expect(uploadArg.files).toBeInstanceOf(Map)
      expect(uploadArg.files.get('alpha/SKILL.md')).toBeInstanceOf(File)
    })

    it('should set partial error when upload fails', async () => {
      mocks.uploadTree.mockRejectedValueOnce(new Error('upload failed'))
      render(<SkillTemplatesSection />)

      fireEvent.click(screen.getAllByRole('button', { name: /workflow\.skill\.startTab\.useThisSkill/i })[0])

      await waitFor(() => {
        expect(mocks.failUpload).toHaveBeenCalledTimes(1)
      })
    })

    it('should not start upload when app id is missing', () => {
      mocks.appId = ''
      render(<SkillTemplatesSection />)

      fireEvent.click(screen.getAllByRole('button', { name: /workflow\.skill\.startTab\.useThisSkill/i })[0])

      expect(mocks.templates[0].loadContent).not.toHaveBeenCalled()
      expect(mocks.uploadTree).not.toHaveBeenCalled()
      expect(mocks.startUpload).not.toHaveBeenCalled()
    })
  })
})
