/**
 * Tests for embedded-chatbot utility functions.
 */

import { isDify } from '../utils'

describe('isDify', () => {
  const originalReferrer = document.referrer

  afterEach(() => {
    Object.defineProperty(document, 'referrer', {
      value: originalReferrer,
      writable: true,
    })
  })

  it('should return true when referrer includes dify.ai', () => {
    Object.defineProperty(document, 'referrer', {
      value: 'https://dify.ai/something',
      writable: true,
    })

    expect(isDify()).toBe(true)
  })

  it('should return true when referrer includes www.dify.ai', () => {
    Object.defineProperty(document, 'referrer', {
      value: 'https://www.dify.ai/app/xyz',
      writable: true,
    })

    expect(isDify()).toBe(true)
  })

  it('should return false when referrer does not include dify.ai', () => {
    Object.defineProperty(document, 'referrer', {
      value: 'https://example.com',
      writable: true,
    })

    expect(isDify()).toBe(false)
  })

  it('should return false when referrer is empty', () => {
    Object.defineProperty(document, 'referrer', {
      value: '',
      writable: true,
    })

    expect(isDify()).toBe(false)
  })

  it('should return false when referrer does not contain dify.ai domain', () => {
    Object.defineProperty(document, 'referrer', {
      value: 'https://example-dify.com',
      writable: true,
    })

    expect(isDify()).toBe(false)
  })

  it('should handle referrer without protocol', () => {
    Object.defineProperty(document, 'referrer', {
      value: 'dify.ai',
      writable: true,
    })

    expect(isDify()).toBe(true)
  })

  it('should return true when referrer includes api.dify.ai', () => {
    Object.defineProperty(document, 'referrer', {
      value: 'https://api.dify.ai/v1/endpoint',
      writable: true,
    })

    expect(isDify()).toBe(true)
  })

  it('should return true when referrer includes app.dify.ai', () => {
    Object.defineProperty(document, 'referrer', {
      value: 'https://app.dify.ai/chat',
      writable: true,
    })

    expect(isDify()).toBe(true)
  })

  it('should return true when referrer includes docs.dify.ai', () => {
    Object.defineProperty(document, 'referrer', {
      value: 'https://docs.dify.ai/guide',
      writable: true,
    })

    expect(isDify()).toBe(true)
  })

  it('should return true when referrer has dify.ai with query parameters', () => {
    Object.defineProperty(document, 'referrer', {
      value: 'https://dify.ai/?ref=test&id=123',
      writable: true,
    })

    expect(isDify()).toBe(true)
  })

  it('should return true when referrer has dify.ai with hash fragment', () => {
    Object.defineProperty(document, 'referrer', {
      value: 'https://dify.ai/page#section',
      writable: true,
    })

    expect(isDify()).toBe(true)
  })

  it('should return true when referrer has dify.ai with port number', () => {
    Object.defineProperty(document, 'referrer', {
      value: 'https://dify.ai:8080/app',
      writable: true,
    })

    expect(isDify()).toBe(true)
  })

  it('should return true when dify.ai appears after another domain', () => {
    Object.defineProperty(document, 'referrer', {
      value: 'https://example.com/redirect?url=https://dify.ai',
      writable: true,
    })

    expect(isDify()).toBe(true)
  })

  it('should return true when substring contains dify.ai', () => {
    Object.defineProperty(document, 'referrer', {
      value: 'https://notdify.ai',
      writable: true,
    })

    expect(isDify()).toBe(true)
  })

  it('should return true when dify.ai is part of a different domain', () => {
    Object.defineProperty(document, 'referrer', {
      value: 'https://fake-dify.ai.example.com',
      writable: true,
    })

    expect(isDify()).toBe(true)
  })

  it('should return true with multiple referrer variations', () => {
    const variations = [
      'https://dify.ai',
      'http://www.dify.ai',
      'http://dify.ai/',
      'https://dify.ai/app?token=123#section',
      'dify.ai/test',
      'www.dify.ai/en',
    ]

    variations.forEach((referrer) => {
      Object.defineProperty(document, 'referrer', {
        value: referrer,
        writable: true,
      })
      expect(isDify()).toBe(true)
    })
  })

  it('should return false with multiple non-dify referrer variations', () => {
    const variations = [
      'https://github.com',
      'https://google.com',
      'https://stackoverflow.com',
      'https://example.dify',
      'https://difyai.com',
      '',
    ]

    variations.forEach((referrer) => {
      Object.defineProperty(document, 'referrer', {
        value: referrer,
        writable: true,
      })
      expect(isDify()).toBe(false)
    })
  })
})
