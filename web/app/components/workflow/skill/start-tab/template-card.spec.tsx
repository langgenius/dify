import type { SkillTemplateSummary } from './templates/types'
import { fireEvent, render, screen } from '@testing-library/react'
import TemplateCard from './template-card'

const createTemplate = (overrides: Partial<SkillTemplateSummary> = {}): SkillTemplateSummary => ({
  id: 'docx',
  name: 'docx',
  description: 'Word document skill',
  fileCount: 60,
  ...overrides,
})

describe('TemplateCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render template metadata when a template is provided', () => {
      render(
        <TemplateCard
          template={createTemplate()}
          onUse={vi.fn()}
        />,
      )

      expect(screen.getByText('docx')).toBeInTheDocument()
      expect(screen.getByText('Word document skill')).toBeInTheDocument()
      expect(screen.getByText('workflow.skill.startTab.filesIncluded:{"count":60}')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /workflow\.skill\.startTab\.useThisSkill/i })).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onUse with template when use button is clicked', () => {
      const template = createTemplate()
      const onUse = vi.fn()
      render(<TemplateCard template={template} onUse={onUse} />)

      fireEvent.click(screen.getByRole('button', { name: /workflow\.skill\.startTab\.useThisSkill/i }))

      expect(onUse).toHaveBeenCalledTimes(1)
      expect(onUse).toHaveBeenCalledWith(template)
    })
  })

  describe('Props', () => {
    it('should render added state and hide use action when added is true', () => {
      const onUse = vi.fn()
      render(
        <TemplateCard
          template={createTemplate()}
          added
          onUse={onUse}
        />,
      )

      expect(screen.getByRole('button', { name: /workflow\.skill\.startTab\.skillAdded/i })).toBeDisabled()
      expect(screen.queryByRole('button', { name: /workflow\.skill\.startTab\.useThisSkill/i })).not.toBeInTheDocument()
    })

    it('should disable use button when disabled is true', () => {
      render(
        <TemplateCard
          template={createTemplate()}
          disabled
          onUse={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: /workflow\.skill\.startTab\.useThisSkill/i })).toBeDisabled()
    })

    it('should render loading status when loading is true', () => {
      render(
        <TemplateCard
          template={createTemplate()}
          loading
          onUse={vi.fn()}
        />,
      )

      expect(screen.getByRole('status')).toBeInTheDocument()
    })
  })
})
