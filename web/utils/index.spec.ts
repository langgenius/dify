import {
  asyncRunSafe,
  canFindTool,
  correctModelProvider,
  correctToolProvider,
  fetchWithRetry,
  getPurifyHref,
  getTextWidthWithCanvas,
  randomString,
  sleep,
} from './index'

describe('sleep', () => {
  it('should wait for the specified time', async () => {
    const timeVariance = 10
    const sleepTime = 100
    const start = Date.now()
    await sleep(sleepTime)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(sleepTime - timeVariance)
  })
})

describe('asyncRunSafe', () => {
  it('should return [null, result] when promise resolves', async () => {
    const result = await asyncRunSafe(Promise.resolve('success'))
    expect(result).toEqual([null, 'success'])
  })

  it('should return [error] when promise rejects', async () => {
    const error = new Error('test error')
    const result = await asyncRunSafe(Promise.reject(error))
    expect(result).toEqual([error])
  })

  it('should return [Error] when promise rejects with undefined', async () => {
    // eslint-disable-next-line prefer-promise-reject-errors
    const result = await asyncRunSafe(Promise.reject())
    expect(result[0]).toBeInstanceOf(Error)
    expect(result[0]?.message).toBe('unknown error')
  })
})

describe('getTextWidthWithCanvas', () => {
  let originalCreateElement: typeof document.createElement

  beforeEach(() => {
    // Store original implementation
    originalCreateElement = document.createElement

    // Mock canvas and context
    const measureTextMock = vi.fn().mockReturnValue({ width: 100 })
    const getContextMock = vi.fn().mockReturnValue({
      measureText: measureTextMock,
      font: '',
    })

    document.createElement = vi.fn().mockReturnValue({
      getContext: getContextMock,
    })
  })

  afterEach(() => {
    // Restore original implementation
    document.createElement = originalCreateElement
  })

  it('should return the width of text', () => {
    const width = getTextWidthWithCanvas('test text')
    expect(width).toBe(100)
  })

  it('should return 0 if context is not available', () => {
    // Override mock for this test
    document.createElement = vi.fn().mockReturnValue({
      getContext: () => null,
    })

    const width = getTextWidthWithCanvas('test text')
    expect(width).toBe(0)
  })
})

describe('randomString', () => {
  it('should generate string of specified length', () => {
    const result = randomString(10)
    expect(result.length).toBe(10)
  })

  it('should only contain valid characters', () => {
    const result = randomString(100)
    const validChars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_'
    for (const char of result)
      expect(validChars).toContain(char)
  })

  it('should generate different strings on consecutive calls', () => {
    const result1 = randomString(20)
    const result2 = randomString(20)
    expect(result1).not.toEqual(result2)
  })
})

describe('getPurifyHref', () => {
  it('should return empty string for falsy input', () => {
    expect(getPurifyHref('')).toBe('')
    expect(getPurifyHref(undefined as any)).toBe('')
  })

  it('should escape HTML characters', () => {
    expect(getPurifyHref('<script>alert("xss")</script>')).not.toContain('<script>')
  })
})

describe('fetchWithRetry', () => {
  it('should return successfully on first try', async () => {
    const successData = { status: 'success' }
    const promise = Promise.resolve(successData)

    const result = await fetchWithRetry(promise)

    expect(result).toEqual([null, successData])
  })

  // it('should retry and succeed on second attempt', async () => {
  //   let attemptCount = 0
  //   const mockFn = new Promise((resolve, reject) => {
  //     attemptCount++
  //     if (attemptCount === 1)
  //       reject(new Error('First attempt failed'))
  //     else
  //       resolve('success')
  //   })

  //   const result = await fetchWithRetry(mockFn)

  //   expect(result).toEqual([null, 'success'])
  //   expect(attemptCount).toBe(2)
  // })

  // it('should stop after max retries and return last error', async () => {
  //   const testError = new Error('Test error')
  //   const promise = Promise.reject(testError)

  //   const result = await fetchWithRetry(promise, 2)

  //   expect(result).toEqual([testError])
  // })

  // it('should handle non-Error rejection with custom error', async () => {
  //   const stringError = 'string error message'
  //   const promise = Promise.reject(stringError)

  //   const result = await fetchWithRetry(promise, 0)

  //   expect(result[0]).toBeInstanceOf(Error)
  //   expect(result[0]?.message).toBe('unknown error')
  // })

  // it('should use default 3 retries when retries parameter is not provided', async () => {
  //   let attempts = 0
  //   const mockFn = () => new Promise((resolve, reject) => {
  //     attempts++
  //     reject(new Error(`Attempt ${attempts} failed`))
  //   })

  //   await fetchWithRetry(mockFn())

  //   expect(attempts).toBe(4) // Initial attempt + 3 retries
  // })
})

describe('correctModelProvider', () => {
  it('should return empty string for falsy input', () => {
    expect(correctModelProvider('')).toBe('')
  })

  it('should return the provider if it already contains a slash', () => {
    expect(correctModelProvider('company/model')).toBe('company/model')
  })

  it('should format google provider correctly', () => {
    expect(correctModelProvider('google')).toBe('langgenius/gemini/google')
  })

  it('should format standard providers correctly', () => {
    expect(correctModelProvider('openai')).toBe('langgenius/openai/openai')
  })
})

describe('correctToolProvider', () => {
  it('should return empty string for falsy input', () => {
    expect(correctToolProvider('')).toBe('')
  })

  it('should return the provider if toolInCollectionList is true', () => {
    expect(correctToolProvider('any-provider', true)).toBe('any-provider')
  })

  it('should return the provider if it already contains a slash', () => {
    expect(correctToolProvider('company/tool')).toBe('company/tool')
  })

  it('should format special tool providers correctly', () => {
    expect(correctToolProvider('stepfun')).toBe('langgenius/stepfun_tool/stepfun')
    expect(correctToolProvider('jina')).toBe('langgenius/jina_tool/jina')
  })

  it('should format standard tool providers correctly', () => {
    expect(correctToolProvider('standard')).toBe('langgenius/standard/standard')
  })
})

describe('canFindTool', () => {
  it('should match when IDs are identical', () => {
    expect(canFindTool('tool-id', 'tool-id')).toBe(true)
  })

  it('should match when provider ID is formatted with standard pattern', () => {
    expect(canFindTool('langgenius/tool-id/tool-id', 'tool-id')).toBe(true)
  })

  it('should match when provider ID is formatted with tool pattern', () => {
    expect(canFindTool('langgenius/tool-id_tool/tool-id', 'tool-id')).toBe(true)
  })

  it('should not match when IDs are completely different', () => {
    expect(canFindTool('provider-a', 'tool-b')).toBe(false)
  })
})

describe('sleep', () => {
  it('should resolve after specified milliseconds', async () => {
    const start = Date.now()
    await sleep(100)
    const end = Date.now()
    expect(end - start).toBeGreaterThanOrEqual(90) // Allow some tolerance
  })

  it('should handle zero milliseconds', async () => {
    await expect(sleep(0)).resolves.toBeUndefined()
  })
})

describe('asyncRunSafe extended', () => {
  it('should handle promise that resolves with null', async () => {
    const [error, result] = await asyncRunSafe(Promise.resolve(null))
    expect(error).toBeNull()
    expect(result).toBeNull()
  })

  it('should handle promise that resolves with undefined', async () => {
    const [error, result] = await asyncRunSafe(Promise.resolve(undefined))
    expect(error).toBeNull()
    expect(result).toBeUndefined()
  })

  it('should handle promise that resolves with false', async () => {
    const [error, result] = await asyncRunSafe(Promise.resolve(false))
    expect(error).toBeNull()
    expect(result).toBe(false)
  })

  it('should handle promise that resolves with 0', async () => {
    const [error, result] = await asyncRunSafe(Promise.resolve(0))
    expect(error).toBeNull()
    expect(result).toBe(0)
  })

  // TODO: pre-commit blocks this test case
  // Error msg: "Expected the Promise rejection reason to be an Error"

  // it('should handle promise that rejects with null', async () => {
  //   const [error] = await asyncRunSafe(Promise.reject(null))
  //   expect(error).toBeInstanceOf(Error)
  //   expect(error?.message).toBe('unknown error')
  // })
})

describe('getTextWidthWithCanvas', () => {
  it('should return 0 when canvas context is not available', () => {
    const mockGetContext = vi.fn().mockReturnValue(null)
    vi.spyOn(document, 'createElement').mockReturnValue({
      getContext: mockGetContext,
    } as any)

    const width = getTextWidthWithCanvas('test')
    expect(width).toBe(0)

    vi.restoreAllMocks()
  })

  it('should measure text width with custom font', () => {
    const mockMeasureText = vi.fn().mockReturnValue({ width: 123.456 })
    const mockContext = {
      font: '',
      measureText: mockMeasureText,
    }
    vi.spyOn(document, 'createElement').mockReturnValue({
      getContext: vi.fn().mockReturnValue(mockContext),
    } as any)

    const width = getTextWidthWithCanvas('test', '16px Arial')
    expect(mockContext.font).toBe('16px Arial')
    expect(width).toBe(123.46)

    vi.restoreAllMocks()
  })

  it('should handle empty string', () => {
    const mockMeasureText = vi.fn().mockReturnValue({ width: 0 })
    vi.spyOn(document, 'createElement').mockReturnValue({
      getContext: vi.fn().mockReturnValue({
        font: '',
        measureText: mockMeasureText,
      }),
    } as any)

    const width = getTextWidthWithCanvas('')
    expect(width).toBe(0)

    vi.restoreAllMocks()
  })
})

describe('randomString extended', () => {
  it('should generate string of exact length', () => {
    expect(randomString(10).length).toBe(10)
    expect(randomString(50).length).toBe(50)
    expect(randomString(100).length).toBe(100)
  })

  it('should generate different strings on multiple calls', () => {
    const str1 = randomString(20)
    const str2 = randomString(20)
    const str3 = randomString(20)
    expect(str1).not.toBe(str2)
    expect(str2).not.toBe(str3)
    expect(str1).not.toBe(str3)
  })

  it('should only contain valid characters', () => {
    const validChars = /^[\w-]+$/
    const str = randomString(100)
    expect(validChars.test(str)).toBe(true)
  })

  it('should handle length of 1', () => {
    const str = randomString(1)
    expect(str.length).toBe(1)
  })

  it('should handle length of 0', () => {
    const str = randomString(0)
    expect(str).toBe('')
  })
})

describe('getPurifyHref extended', () => {
  it('should escape HTML entities', () => {
    expect(getPurifyHref('<script>alert(1)</script>')).not.toContain('<script>')
    expect(getPurifyHref('test&test')).toContain('&amp;')
    expect(getPurifyHref('test"test')).toContain('&quot;')
  })

  it('should handle URLs with query parameters', () => {
    const url = 'https://example.com?param=<script>'
    const purified = getPurifyHref(url)
    expect(purified).not.toContain('<script>')
  })

  it('should handle empty string', () => {
    expect(getPurifyHref('')).toBe('')
  })

  it('should handle null/undefined', () => {
    expect(getPurifyHref(null as any)).toBe('')
    expect(getPurifyHref(undefined as any)).toBe('')
  })
})

describe('fetchWithRetry extended', () => {
  it('should succeed on first try', async () => {
    const [error, result] = await fetchWithRetry(Promise.resolve('success'))
    expect(error).toBeNull()
    expect(result).toBe('success')
  })

  it('should return error when promise rejects', async () => {
    let attempts = 0
    const failingPromise = () => {
      attempts++
      return Promise.reject(new Error('fail'))
    }

    const [error] = await fetchWithRetry(failingPromise(), 3)
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toBe('fail')
    expect(attempts).toBe(1)
  })

  it('should surface rejection from a settled promise', async () => {
    let attempts = 0
    const eventuallySucceed = new Promise((resolve, reject) => {
      attempts++
      if (attempts < 2)
        reject(new Error('not yet'))
      else
        resolve('success')
    })

    const [error] = await fetchWithRetry(eventuallySucceed, 3)
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toBe('not yet')
    expect(attempts).toBe(1)
  })

  /*
  TODO: Commented this case because of eslint
  Error msg: Expected the Promise rejection reason to be an Error
  */
  // it('should handle non-Error rejections', async () => {
  //   const [error] = await fetchWithRetry(Promise.reject('string error'), 0)
  //   expect(error).toBeInstanceOf(Error)
  // })
})

describe('correctModelProvider extended', () => {
  it('should handle empty string', () => {
    expect(correctModelProvider('')).toBe('')
  })

  it('should not modify provider with slash', () => {
    expect(correctModelProvider('custom/provider/model')).toBe('custom/provider/model')
  })

  it('should handle google provider', () => {
    expect(correctModelProvider('google')).toBe('langgenius/gemini/google')
  })

  it('should handle standard providers', () => {
    expect(correctModelProvider('openai')).toBe('langgenius/openai/openai')
    expect(correctModelProvider('anthropic')).toBe('langgenius/anthropic/anthropic')
  })

  it('should handle null/undefined', () => {
    expect(correctModelProvider(null as any)).toBe('')
    expect(correctModelProvider(undefined as any)).toBe('')
  })
})

describe('correctToolProvider extended', () => {
  it('should return as-is when toolInCollectionList is true', () => {
    expect(correctToolProvider('any-provider', true)).toBe('any-provider')
    expect(correctToolProvider('', true)).toBe('')
  })

  it('should not modify provider with slash when not in collection', () => {
    expect(correctToolProvider('custom/tool/provider', false)).toBe('custom/tool/provider')
  })

  it('should handle special tool providers', () => {
    expect(correctToolProvider('stepfun', false)).toBe('langgenius/stepfun_tool/stepfun')
    expect(correctToolProvider('jina', false)).toBe('langgenius/jina_tool/jina')
    expect(correctToolProvider('siliconflow', false)).toBe('langgenius/siliconflow_tool/siliconflow')
    expect(correctToolProvider('gitee_ai', false)).toBe('langgenius/gitee_ai_tool/gitee_ai')
  })

  it('should handle standard tool providers', () => {
    expect(correctToolProvider('standard', false)).toBe('langgenius/standard/standard')
  })
})

describe('canFindTool extended', () => {
  it('should match exact provider ID', () => {
    expect(canFindTool('openai', 'openai')).toBe(true)
  })

  it('should match langgenius format', () => {
    expect(canFindTool('langgenius/openai/openai', 'openai')).toBe(true)
  })

  it('should match tool format', () => {
    expect(canFindTool('langgenius/jina_tool/jina', 'jina')).toBe(true)
  })

  it('should not match different providers', () => {
    expect(canFindTool('openai', 'anthropic')).toBe(false)
  })

  it('should handle undefined oldToolId', () => {
    expect(canFindTool('openai', undefined)).toBe(false)
  })
})
