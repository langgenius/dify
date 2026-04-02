import { prepareSkillUploadFile } from '../skill-upload-utils'

describe('skill-upload-utils', () => {
  it('should wrap markdown files into the skill upload payload', async () => {
    const file = new File(['# Skill body'], 'SKILL.md', { type: 'text/markdown' })

    const prepared = await prepareSkillUploadFile(file)

    expect(prepared).not.toBe(file)
    expect(prepared.name).toBe('SKILL.md')
    expect(prepared.type).toBe('text/markdown')
    await expect(prepared.text()).resolves.toBe(JSON.stringify({
      content: '# Skill body',
      metadata: {},
    }))
  })

  it('should keep non-markdown files untouched', async () => {
    const file = new File(['binary'], 'archive.zip', { type: 'application/zip' })

    const prepared = await prepareSkillUploadFile(file)

    expect(prepared).toBe(file)
  })

  it('should fallback to text/plain when the source markdown file has no explicit type', async () => {
    const file = new File(['# Skill body'], 'SKILL.md')

    const prepared = await prepareSkillUploadFile(file)

    expect(prepared.type).toBe('text/plain')
    await expect(prepared.text()).resolves.toBe(JSON.stringify({
      content: '# Skill body',
      metadata: {},
    }))
  })
})
