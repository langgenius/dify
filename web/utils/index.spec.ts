import {
  asyncRunSafe,
  canFindTool,
  correctModelProvider,
  correctToolProvider,
  fetchWithRetry,
  getPurifyHref,
  getTextWidthWithCanvas,
  randomString,
  removeSpecificQueryParam,
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
    const measureTextMock = jest.fn().mockReturnValue({ width: 100 })
    const getContextMock = jest.fn().mockReturnValue({
      measureText: measureTextMock,
      font: '',
    })

    document.createElement = jest.fn().mockReturnValue({
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
    document.createElement = jest.fn().mockReturnValue({
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

describe('removeSpecificQueryParam', () => {
  let originalLocation: Location
  let originalReplaceState: typeof window.history.replaceState

  beforeEach(() => {
    originalLocation = window.location
    originalReplaceState = window.history.replaceState

    const mockUrl = new URL('https://example.com?param1=value1&param2=value2&param3=value3')

    // Mock window.location using defineProperty to handle URL properly
    delete (window as any).location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...originalLocation,
        href: mockUrl.href,
        search: mockUrl.search,
        toString: () => mockUrl.toString(),
      },
    })

    window.history.replaceState = jest.fn()
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    })
    window.history.replaceState = originalReplaceState
  })

  it('should remove a single query parameter', () => {
    removeSpecificQueryParam('param2')
    expect(window.history.replaceState).toHaveBeenCalledTimes(1)
    const replaceStateCall = (window.history.replaceState as jest.Mock).mock.calls[0]
    expect(replaceStateCall[0]).toBe(null)
    expect(replaceStateCall[1]).toBe('')
    expect(replaceStateCall[2]).toMatch(/param1=value1/)
    expect(replaceStateCall[2]).toMatch(/param3=value3/)
    expect(replaceStateCall[2]).not.toMatch(/param2=value2/)
  })

  it('should remove multiple query parameters', () => {
    removeSpecificQueryParam(['param1', 'param3'])
    expect(window.history.replaceState).toHaveBeenCalledTimes(1)
    const replaceStateCall = (window.history.replaceState as jest.Mock).mock.calls[0]
    expect(replaceStateCall[2]).toMatch(/param2=value2/)
    expect(replaceStateCall[2]).not.toMatch(/param1=value1/)
    expect(replaceStateCall[2]).not.toMatch(/param3=value3/)
  })

  it('should handle non-existent parameters gracefully', () => {
    removeSpecificQueryParam('nonexistent')

    expect(window.history.replaceState).toHaveBeenCalledTimes(1)
    const replaceStateCall = (window.history.replaceState as jest.Mock).mock.calls[0]
    expect(replaceStateCall[2]).toMatch(/param1=value1/)
    expect(replaceStateCall[2]).toMatch(/param2=value2/)
    expect(replaceStateCall[2]).toMatch(/param3=value3/)
  })
})
