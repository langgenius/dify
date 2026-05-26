import { vi } from 'vitest'

export function resolveDocLink(path: string, baseUrl = 'https://docs.example.com') {
  return `${baseUrl}${path}`
}

export function createDocLinkMock(baseUrl = 'https://docs.example.com') {
  return vi.fn((path: string) => resolveDocLink(path, baseUrl))
}
