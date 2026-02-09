import type { SkillTemplateNode } from './types'
import { buildUploadDataFromTemplate } from './template-to-upload'

const mocks = vi.hoisted(() => ({
  prepareSkillUploadFile: vi.fn(),
}))

vi.mock('../../utils/skill-upload-utils', () => ({
  prepareSkillUploadFile: (...args: unknown[]) => mocks.prepareSkillUploadFile(...args),
}))

describe('buildUploadDataFromTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prepareSkillUploadFile.mockImplementation(async (file: File) => file)
  })

  describe('Tree Conversion', () => {
    it('should convert template nodes into upload tree and files map', async () => {
      const children: SkillTemplateNode[] = [
        {
          name: 'SKILL.md',
          node_type: 'file',
          content: '# Skill',
        },
        {
          name: 'assets',
          node_type: 'folder',
          children: [
            {
              name: 'logo.txt',
              node_type: 'file',
              content: btoa('PNG'),
              encoding: 'base64',
            },
          ],
        },
      ]

      const result = await buildUploadDataFromTemplate('my-skill', children)
      const skillFile = result.files.get('my-skill/SKILL.md')
      const logoFile = result.files.get('my-skill/assets/logo.txt')

      expect(result.tree).toHaveLength(1)
      expect(result.tree[0].name).toBe('my-skill')
      expect(result.tree[0].node_type).toBe('folder')
      expect(result.tree[0].children).toEqual([
        { name: 'SKILL.md', node_type: 'file', size: skillFile?.size ?? 0 },
        {
          name: 'assets',
          node_type: 'folder',
          children: [{ name: 'logo.txt', node_type: 'file', size: logoFile?.size ?? 0 }],
        },
      ])
      expect(result.files.size).toBe(2)
      expect(skillFile).toBeInstanceOf(File)
      expect(logoFile).toBeInstanceOf(File)

      expect(logoFile?.size).toBe(3)
      expect(mocks.prepareSkillUploadFile).toHaveBeenCalledTimes(2)
    })
  })

  describe('Edge Cases', () => {
    it('should return empty root folder when template has no children', async () => {
      const result = await buildUploadDataFromTemplate('empty-skill', [])

      expect(result.tree).toEqual([
        {
          name: 'empty-skill',
          node_type: 'folder',
          children: [],
        },
      ])
      expect(result.files.size).toBe(0)
      expect(mocks.prepareSkillUploadFile).not.toHaveBeenCalled()
    })
  })
})
