import type { SkillTemplateNode } from './types'
import { SKILL_TEMPLATES } from './registry'

const countFiles = (nodes: SkillTemplateNode[]): number => {
  return nodes.reduce((acc, node) => {
    if (node.node_type === 'file')
      return acc + 1
    return acc + countFiles(node.children)
  }, 0)
}

const hasFileNamed = (nodes: SkillTemplateNode[], fileName: string): boolean => {
  return nodes.some((node) => {
    if (node.node_type === 'file')
      return node.name === fileName
    return hasFileNamed(node.children, fileName)
  })
}

describe('SKILL_TEMPLATES registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Registry Structure', () => {
    it('should keep template ids unique', () => {
      const ids = SKILL_TEMPLATES.map(template => template.id)
      const uniqueIds = new Set(ids)

      expect(uniqueIds.size).toBe(ids.length)
    })
  })

  describe('Template Content', () => {
    it('should load each template and keep fileCount in sync with actual content', async () => {
      const mismatches: string[] = []

      for (const template of SKILL_TEMPLATES) {
        const content = await template.loadContent()
        const actualCount = countFiles(content)

        expect(content.length).toBeGreaterThan(0)
        expect(hasFileNamed(content, 'SKILL.md')).toBe(true)
        if (actualCount !== template.fileCount)
          mismatches.push(`${template.id}:${template.fileCount}->${actualCount}`)
      }

      expect(mismatches).toEqual([])
    }, 20000)
  })
})
