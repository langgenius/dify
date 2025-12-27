import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
/**
 * Test suite for tool call utility functions
 * Tests detection of function/tool call support in AI models
 */
import { supportFunctionCall } from './tool-call'

describe('tool-call', () => {
  /**
   * Tests supportFunctionCall which checks if a model supports any form of
   * function calling (toolCall, multiToolCall, or streamToolCall)
   */
  describe('supportFunctionCall', () => {
    /**
     * Tests detection of basic tool call support
     */
    it('returns true when features include toolCall', () => {
      const features = [ModelFeatureEnum.toolCall]
      expect(supportFunctionCall(features)).toBe(true)
    })

    /**
     * Tests detection of multi-tool call support (calling multiple tools in one request)
     */
    it('returns true when features include multiToolCall', () => {
      const features = [ModelFeatureEnum.multiToolCall]
      expect(supportFunctionCall(features)).toBe(true)
    })

    /**
     * Tests detection of streaming tool call support
     */
    it('returns true when features include streamToolCall', () => {
      const features = [ModelFeatureEnum.streamToolCall]
      expect(supportFunctionCall(features)).toBe(true)
    })

    it('returns true when features include multiple tool call types', () => {
      const features = [
        ModelFeatureEnum.toolCall,
        ModelFeatureEnum.multiToolCall,
        ModelFeatureEnum.streamToolCall,
      ]
      expect(supportFunctionCall(features)).toBe(true)
    })

    /**
     * Tests that tool call support is detected even when mixed with other features
     */
    it('returns true when features include tool call among other features', () => {
      const features = [
        ModelFeatureEnum.agentThought,
        ModelFeatureEnum.toolCall,
        ModelFeatureEnum.vision,
      ]
      expect(supportFunctionCall(features)).toBe(true)
    })

    /**
     * Tests that false is returned when no tool call features are present
     */
    it('returns false when features do not include any tool call type', () => {
      const features = [ModelFeatureEnum.agentThought, ModelFeatureEnum.vision]
      expect(supportFunctionCall(features)).toBe(false)
    })

    it('returns false for empty array', () => {
      expect(supportFunctionCall([])).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(supportFunctionCall(undefined)).toBe(false)
    })

    it('returns false for null', () => {
      expect(supportFunctionCall(null as any)).toBe(false)
    })
  })
})
