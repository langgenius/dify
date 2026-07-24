import { FlowType } from '@/types/common'
/**
 * Test suite for service utility functions
 *
 * This module provides utilities for working with different flow types in the application.
 * Flow types determine the API endpoint prefix used for various operations.
 *
 * Key concepts:
 * - FlowType.appFlow: Standard application workflows (prefix: 'apps')
 * - FlowType.ragPipeline: RAG (Retrieval-Augmented Generation) pipelines (prefix: 'rag/pipelines')
 *
 * The getFlowPrefix function maps flow types to their corresponding API path prefixes,
 * with a fallback to 'apps' for undefined or unknown flow types.
 */
import { flowPrefixMap, getFlowPrefix } from './utils'

describe('Service Utils', () => {
  describe('flowPrefixMap', () => {
    /**
     * Test that the flowPrefixMap object contains the expected mappings
     * This ensures the mapping configuration is correct
     */
    it('should have correct flow type to prefix mappings', () => {
      expect(flowPrefixMap[FlowType.appFlow]).toBe('apps')
      expect(flowPrefixMap[FlowType.ragPipeline]).toBe('rag/pipelines')
    })

    /**
     * Test that the map only contains the expected flow types
     * This helps catch unintended additions to the mapping
     */
    it('should contain exactly two flow type mappings', () => {
      const keys = Object.keys(flowPrefixMap)
      expect(keys).toHaveLength(2)
    })
  })

  describe('getFlowPrefix', () => {
    /**
     * Test that appFlow type returns the correct prefix
     * This is the most common flow type for standard application workflows
     */
    it('should return "apps" for appFlow type', () => {
      const result = getFlowPrefix(FlowType.appFlow)
      expect(result).toBe('apps')
    })

    /**
     * Test that ragPipeline type returns the correct prefix
     * RAG pipelines have a different API structure with nested paths
     */
    it('should return "rag/pipelines" for ragPipeline type', () => {
      const result = getFlowPrefix(FlowType.ragPipeline)
      expect(result).toBe('rag/pipelines')
    })

    /**
     * Test fallback behavior when no flow type is provided
     * Should default to 'apps' prefix for backward compatibility
     */
    it('should return "apps" when flow type is undefined', () => {
      const result = getFlowPrefix(undefined)
      expect(result).toBe('apps')
    })

    /**
     * Test fallback behavior for unknown flow types
     * Any unrecognized flow type should default to 'apps'
     */
    it('should return "apps" for unknown flow type', () => {
      // Cast to FlowType to test the fallback behavior
      const unknownType = 'unknown' as FlowType
      const result = getFlowPrefix(unknownType)
      expect(result).toBe('apps')
    })

    /**
     * Test that the function handles null gracefully
     * Null should be treated the same as undefined
     */
    it('should return "apps" when flow type is null', () => {
      const result = getFlowPrefix(null as any)
      expect(result).toBe('apps')
    })

    /**
     * Test consistency with flowPrefixMap
     * The function should return the same values as direct map access
     */
    it('should return values consistent with flowPrefixMap', () => {
      expect(getFlowPrefix(FlowType.appFlow)).toBe(flowPrefixMap[FlowType.appFlow])
      expect(getFlowPrefix(FlowType.ragPipeline)).toBe(flowPrefixMap[FlowType.ragPipeline])
    })
  })

  describe('Integration scenarios', () => {
    /**
     * Test typical usage pattern in API path construction
     * This demonstrates how the function is used in real application code
     */
    it('should construct correct API paths for different flow types', () => {
      const appId = '123'

      // App flow path construction
      const appFlowPath = `/${getFlowPrefix(FlowType.appFlow)}/${appId}`
      expect(appFlowPath).toBe('/apps/123')

      // RAG pipeline path construction
      const ragPipelinePath = `/${getFlowPrefix(FlowType.ragPipeline)}/${appId}`
      expect(ragPipelinePath).toBe('/rag/pipelines/123')
    })

    /**
     * Test that the function can be used in conditional logic
     * Common pattern for determining which API endpoint to use
     */
    it('should support conditional API routing logic', () => {
      const determineEndpoint = (flowType?: FlowType, resourceId?: string) => {
        const prefix = getFlowPrefix(flowType)
        return `/${prefix}/${resourceId || 'default'}`
      }

      expect(determineEndpoint(FlowType.appFlow, 'app-1')).toBe('/apps/app-1')
      expect(determineEndpoint(FlowType.ragPipeline, 'pipeline-1')).toBe('/rag/pipelines/pipeline-1')
      expect(determineEndpoint(undefined, 'fallback')).toBe('/apps/fallback')
    })

    /**
     * Test behavior with empty string flow type
     * Empty strings should fall back to default
     */
    it('should handle empty string as flow type', () => {
      const result = getFlowPrefix('' as any)
      expect(result).toBe('apps')
    })
  })

  describe('Type safety', () => {
    /**
     * Test that all FlowType enum values are handled
     * This ensures we don't miss any flow types in the mapping
     */
    it('should handle all FlowType enum values', () => {
      // Get all enum values
      const flowTypes = Object.values(FlowType)

      // Each flow type should return a valid prefix
      flowTypes.forEach((flowType) => {
        const prefix = getFlowPrefix(flowType)
        expect(prefix).toBeTruthy()
        expect(typeof prefix).toBe('string')
        expect(prefix.length).toBeGreaterThan(0)
      })
    })

    /**
     * Test that returned prefixes are valid path segments
     * Prefixes should not contain leading/trailing slashes or invalid characters
     */
    it('should return valid path segments without leading/trailing slashes', () => {
      const appFlowPrefix = getFlowPrefix(FlowType.appFlow)
      const ragPipelinePrefix = getFlowPrefix(FlowType.ragPipeline)

      expect(appFlowPrefix).not.toMatch(/^\//)
      expect(appFlowPrefix).not.toMatch(/\/$/)
      expect(ragPipelinePrefix).not.toMatch(/^\//)
      expect(ragPipelinePrefix).not.toMatch(/\/$/)
    })
  })
})
