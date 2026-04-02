import type { ZipValidationError } from '../zip-extract'
import { extractAndValidateZip } from '../zip-extract'

type MockZipEntry = {
  name: string
  originalSize: number
}

type MockUnzipScenario = {
  entries?: MockZipEntry[]
  result?: Record<string, Uint8Array>
  error?: Error
  errorAfterFilter?: Error
}

const mocks = vi.hoisted(() => ({
  scenario: null as MockUnzipScenario | null,
}))

const expectZipValidationError = async (promise: Promise<unknown>, code: ZipValidationError['code']) => {
  await expect(promise).rejects.toMatchObject({
    code,
  } satisfies Partial<ZipValidationError>)
}

vi.mock('fflate', () => ({
  unzip: (
    _data: Uint8Array,
    options: { filter: (file: MockZipEntry) => boolean },
    callback: (error: Error | null, result: Record<string, Uint8Array>) => void,
  ) => {
    const scenario = mocks.scenario

    if (!scenario) {
      callback(new Error('missing scenario'), {})
      return
    }

    if (scenario.error) {
      callback(scenario.error, {})
      return
    }

    const filteredResult = Object.fromEntries(
      (scenario.entries ?? [])
        .filter(entry => options.filter(entry))
        .map((entry) => {
          const data = scenario.result?.[entry.name] ?? new Uint8Array(entry.originalSize)
          return [entry.name, data]
        }),
    )

    if (scenario.errorAfterFilter) {
      callback(scenario.errorAfterFilter, {})
      return
    }

    callback(null, filteredResult)
  },
}))

describe('zip-extract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.scenario = null
  })

  it('should extract a zip with one root folder and ignore system files', async () => {
    mocks.scenario = {
      entries: [
        { name: 'demo-skill/SKILL.md', originalSize: 7 },
        { name: 'demo-skill/assets/logo.txt', originalSize: 4 },
        { name: '__MACOSX/demo-skill/.DS_Store', originalSize: 1 },
        { name: 'demo-skill/.DS_Store', originalSize: 1 },
      ],
      result: {
        'demo-skill/SKILL.md': new TextEncoder().encode('# Skill'),
        'demo-skill/assets/logo.txt': new TextEncoder().encode('logo'),
      },
    }

    const result = await extractAndValidateZip(new ArrayBuffer(8))

    expect(result.rootFolderName).toBe('demo-skill')
    expect([...result.files.keys()]).toEqual([
      'demo-skill/SKILL.md',
      'demo-skill/assets/logo.txt',
    ])
  })

  it('should reject archives without files', async () => {
    mocks.scenario = {
      entries: [],
      result: {},
    }

    await expectZipValidationError(extractAndValidateZip(new ArrayBuffer(8)), 'empty_zip')
  })

  it('should reject archives with multiple root folders', async () => {
    mocks.scenario = {
      entries: [
        { name: 'demo-a/SKILL.md', originalSize: 3 },
        { name: 'demo-b/SKILL.md', originalSize: 3 },
      ],
      result: {
        'demo-a/SKILL.md': new TextEncoder().encode('# A'),
        'demo-b/SKILL.md': new TextEncoder().encode('# B'),
      },
    }

    await expectZipValidationError(extractAndValidateZip(new ArrayBuffer(8)), 'no_root_folder')
  })

  it('should reject archives with unsafe paths', async () => {
    mocks.scenario = {
      entries: [{ name: 'demo-skill/../evil.txt', originalSize: 4 }],
      result: {},
    }

    await expectZipValidationError(extractAndValidateZip(new ArrayBuffer(8)), 'path_traversal')
  })

  it('should reject archives with too many files', async () => {
    mocks.scenario = {
      entries: Array.from({ length: 201 }, (_, index) => ({
        name: `demo-skill/file-${index}.txt`,
        originalSize: 1,
      })),
      result: {},
    }

    await expectZipValidationError(extractAndValidateZip(new ArrayBuffer(8)), 'too_many_files')
  })

  it('should reject zip files that exceed the compressed size limit before extraction', async () => {
    await expectZipValidationError(extractAndValidateZip(new ArrayBuffer(51 * 1024 * 1024)), 'zip_too_large')
  })

  it('should ignore directory entries while extracting', async () => {
    mocks.scenario = {
      entries: [
        { name: 'demo-skill/', originalSize: 0 },
        { name: 'demo-skill/SKILL.md', originalSize: 7 },
      ],
      result: {
        'demo-skill/SKILL.md': new TextEncoder().encode('# Skill'),
      },
    }

    const result = await extractAndValidateZip(new ArrayBuffer(8))
    expect([...result.files.keys()]).toEqual(['demo-skill/SKILL.md'])
  })

  it('should reject archives when filtered extracted size exceeds the estimate limit', async () => {
    mocks.scenario = {
      entries: [
        { name: 'demo-skill/huge.bin', originalSize: 201 * 1024 * 1024 },
      ],
      result: {},
    }

    await expectZipValidationError(extractAndValidateZip(new ArrayBuffer(8)), 'extracted_too_large')
  })

  it('should reject archives when extracted file data exceeds the actual size limit', async () => {
    const huge = new Uint8Array(201 * 1024 * 1024)
    mocks.scenario = {
      entries: [
        { name: 'demo-skill/huge.bin', originalSize: 1 },
      ],
      result: {
        'demo-skill/huge.bin': huge,
      },
    }

    await expectZipValidationError(extractAndValidateZip(new ArrayBuffer(8)), 'extracted_too_large')
  })

  it('should reject invalid zip data', async () => {
    mocks.scenario = {
      error: new Error('bad zip'),
    }

    await expectZipValidationError(extractAndValidateZip(new ArrayBuffer(8)), 'invalid_zip')
  })

  it('should preserve the original filter validation error when decompression fails afterward', async () => {
    mocks.scenario = {
      entries: [{ name: 'demo-skill/../evil.txt', originalSize: 4 }],
      errorAfterFilter: new Error('bad zip'),
    }

    await expectZipValidationError(extractAndValidateZip(new ArrayBuffer(8)), 'path_traversal')
  })

  it('should ignore common Windows system files while extracting', async () => {
    mocks.scenario = {
      entries: [
        { name: 'demo-skill/Thumbs.db', originalSize: 1 },
        { name: 'demo-skill/desktop.ini', originalSize: 1 },
        { name: 'demo-skill/SKILL.md', originalSize: 7 },
      ],
      result: {
        'demo-skill/SKILL.md': new TextEncoder().encode('# Skill'),
      },
    }

    const result = await extractAndValidateZip(new ArrayBuffer(8))

    expect([...result.files.keys()]).toEqual(['demo-skill/SKILL.md'])
  })
})
