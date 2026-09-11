import { shouldUseDetailSidebar } from '../routes'

const defaultOptions = {
  agentV2Enabled: true,
  isCurrentWorkspaceDatasetOperator: false,
}

describe('shouldUseDetailSidebar', () => {
  it.each([
    '/datasets/dataset-1/documents',
    '/datasets/dataset-1/documents/document-1/settings',
    '/datasets/dataset-1/documents/create',
    '/datasets/dataset-1/documents/create-from-pipeline',
    '/datasets/dataset-1/hitTesting',
    '/datasets/dataset-1/settings',
  ])('returns true for dataset detail route %s', (pathname) => {
    expect(shouldUseDetailSidebar(pathname, defaultOptions)).toBe(true)
  })

  it.each([
    '/datasets',
    '/datasets/create',
    '/datasets/create-from-pipeline',
    '/datasets/connect',
    '/datasets/new/create',
  ])('returns false for dataset collection route %s', (pathname) => {
    expect(shouldUseDetailSidebar(pathname, defaultOptions)).toBe(false)
  })
})
