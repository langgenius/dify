import { isDify } from '../utils'

describe('isDify', () => {
  const originalReferrer = document.referrer
  afterEach(() => {
    Object.defineProperty(document, 'referrer', { value: originalReferrer, configurable: true })
  })

  it.each([
    ['https://dify.ai', true],
    ['http://www.dify.ai/app?source=embed', true],
    ['https://APP.DIFY.AI:8080/chat', true],
    ['https://example.com', false],
    ['https://example.com/redirect?url=https://dify.ai', false],
    ['https://notdify.ai', false],
    ['https://dify.ai.example.com', false],
    ['https://dify.ai@evil.example', false],
    ['', false],
    ['dify.ai/test', false],
  ])('uses the actual referrer hostname for %s', (referrer, expected) => {
    Object.defineProperty(document, 'referrer', { value: referrer, configurable: true })
    expect(isDify()).toBe(expected)
  })
})
