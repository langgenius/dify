import { describe, expect, it } from 'vitest'
import { getFrontendCapabilities, getRouteContext } from '../capabilities'

describe('agent context capabilities', () => {
  it('should expose Dify frontend capability areas', () => {
    const capabilities = getFrontendCapabilities()

    expect(capabilities.some(capability => capability.id === 'apps')).toBe(true)
    expect(capabilities.some(capability => capability.id === 'workflow')).toBe(true)
    expect(capabilities.some(capability => capability.id === 'published-app-runtime')).toBe(true)
    expect(capabilities.some(capability => capability.id === 'tools')).toBe(true)
  })

  it('should infer workflow route context', () => {
    const context = getRouteContext('/app/app-123/workflow')

    expect(context.page_type).toBe('workflow-builder')
    expect(context.app_id).toBe('app-123')
    expect(context.capability_ids).toContain('workflow')
  })

  it('should infer dataset route context', () => {
    const context = getRouteContext('/datasets/dataset-123')

    expect(context.page_type).toBe('datasets')
    expect(context.dataset_id).toBe('dataset-123')
    expect(context.capability_ids).toContain('datasets')
  })

  it('should infer RAG pipeline route context', () => {
    const context = getRouteContext('/datasets/dataset-123/pipeline')

    expect(context.page_type).toBe('rag-pipeline-builder')
    expect(context.dataset_id).toBe('dataset-123')
    expect(context.capability_ids).toContain('rag-pipeline')
  })

  it('should infer published app runtime context', () => {
    const context = getRouteContext('/workflow/public-token')

    expect(context.page_type).toBe('published-app-runtime')
    expect(context.token).toBe('public-token')
    expect(context.capability_ids).toContain('published-app-runtime')
  })
})
