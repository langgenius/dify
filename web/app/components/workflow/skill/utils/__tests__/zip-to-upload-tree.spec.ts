import { buildUploadDataFromZip } from '../zip-to-upload-tree'

const mocks = vi.hoisted(() => ({
  prepareSkillUploadFile: vi.fn<(file: File) => Promise<File>>(),
}))

vi.mock('../skill-upload-utils', () => ({
  prepareSkillUploadFile: (file: File) => mocks.prepareSkillUploadFile(file),
}))

describe('zip-to-upload-tree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prepareSkillUploadFile.mockImplementation(async file => file)
  })

  it('should convert extracted zip files into upload tree data', async () => {
    const extracted = {
      rootFolderName: 'demo-skill',
      files: new Map<string, Uint8Array>([
        ['demo-skill/SKILL.md', new Uint8Array([35, 32, 83, 107, 105, 108, 108])],
        ['demo-skill/assets/logo.png', new Uint8Array([1, 2, 3])],
      ]),
    }

    const result = await buildUploadDataFromZip(extracted)

    expect([...result.files.keys()]).toEqual([
      'demo-skill/SKILL.md',
      'demo-skill/assets/logo.png',
    ])
    expect(result.tree).toEqual([
      {
        name: 'demo-skill',
        node_type: 'folder',
        children: [
          {
            name: 'SKILL.md',
            node_type: 'file',
            size: result.files.get('demo-skill/SKILL.md')?.size ?? 0,
          },
          {
            name: 'assets',
            node_type: 'folder',
            children: [
              {
                name: 'logo.png',
                node_type: 'file',
                size: result.files.get('demo-skill/assets/logo.png')?.size ?? 0,
              },
            ],
          },
        ],
      },
    ])
    expect(mocks.prepareSkillUploadFile).toHaveBeenCalledTimes(2)
    expect(result.files.get('demo-skill/SKILL.md')?.type).toBe('text/markdown')
    expect(result.files.get('demo-skill/assets/logo.png')?.type).toBe('application/octet-stream')
  })
})
