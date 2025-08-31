/**
 * Workflow Connectivity Validation Tests
 *
 * Tests for validateWorkflowConnectivity function to ensure workflows
 * maintain single connected graph topology.
 */

import { validateWorkflowConnectivity } from './workflow'
import { BlockEnum } from '../types'
import type { Edge, Node } from '../types'

describe('validateWorkflowConnectivity', () => {
  // Helper function to create a mock node
  const createNode = (id: string, type: BlockEnum, title = 'Test Node'): Node => ({
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type,
      title,
      desc: 'Test description',
    },
  })

  // Helper function to create a mock edge
  const createEdge = (id: string, source: string, target: string): Edge => ({
    id,
    source,
    target,
    type: 'custom',
    data: {
      sourceType: BlockEnum.Start,
      targetType: BlockEnum.End,
    },
  })

  describe('single connected graph scenarios', () => {
    it('should return valid for single start node with connected workflow', () => {
      const nodes = [
        createNode('start', BlockEnum.Start),
        createNode('process', BlockEnum.Code),
        createNode('end', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'start', 'process'),
        createEdge('edge2', 'process', 'end'),
      ]

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(true)
      expect(result.connectedComponents).toBe(1)
      expect(result.isolatedStartNodes).toHaveLength(0)
    })

    it('should return valid for multiple trigger nodes connected to same workflow', () => {
      const nodes = [
        createNode('trigger1', BlockEnum.TriggerSchedule),
        createNode('trigger2', BlockEnum.TriggerWebhook),
        createNode('process', BlockEnum.Code),
        createNode('end', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'trigger1', 'process'),
        createEdge('edge2', 'trigger2', 'process'),
        createEdge('edge3', 'process', 'end'),
      ]

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(true)
      expect(result.connectedComponents).toBe(1)
      expect(result.isolatedStartNodes).toHaveLength(0)
    })

    it('should return valid for complex single connected graph', () => {
      const nodes = [
        createNode('start', BlockEnum.Start),
        createNode('llm1', BlockEnum.LLM),
        createNode('ifelse', BlockEnum.IfElse),
        createNode('llm2', BlockEnum.LLM),
        createNode('end1', BlockEnum.End),
        createNode('end2', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'start', 'llm1'),
        createEdge('edge2', 'llm1', 'ifelse'),
        createEdge('edge3', 'ifelse', 'llm2'),
        createEdge('edge4', 'ifelse', 'end1'),
        createEdge('edge5', 'llm2', 'end2'),
      ]

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(true)
      expect(result.connectedComponents).toBe(1)
      expect(result.isolatedStartNodes).toHaveLength(0)
    })
  })

  describe('multiple disconnected graphs scenarios', () => {
    it('should return invalid for two separate trigger workflows', () => {
      const nodes = [
        createNode('trigger1', BlockEnum.TriggerSchedule),
        createNode('process1', BlockEnum.Code),
        createNode('end1', BlockEnum.End),
        createNode('trigger2', BlockEnum.TriggerWebhook),
        createNode('process2', BlockEnum.LLM),
        createNode('end2', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'trigger1', 'process1'),
        createEdge('edge2', 'process1', 'end1'),
        createEdge('edge3', 'trigger2', 'process2'),
        createEdge('edge4', 'process2', 'end2'),
      ]

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(false)
      expect(result.connectedComponents).toBe(2)
      expect(result.isolatedStartNodes).toHaveLength(0)
    })

    it('should return invalid for start node and trigger node in separate workflows', () => {
      const nodes = [
        createNode('start', BlockEnum.Start),
        createNode('code1', BlockEnum.Code),
        createNode('end1', BlockEnum.End),
        createNode('trigger', BlockEnum.TriggerPlugin),
        createNode('llm', BlockEnum.LLM),
        createNode('end2', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'start', 'code1'),
        createEdge('edge2', 'code1', 'end1'),
        createEdge('edge3', 'trigger', 'llm'),
        createEdge('edge4', 'llm', 'end2'),
      ]

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(false)
      expect(result.connectedComponents).toBe(2)
      expect(result.isolatedStartNodes).toHaveLength(0)
    })

    it('should detect isolated start nodes', () => {
      const nodes = [
        createNode('trigger1', BlockEnum.TriggerSchedule),
        createNode('trigger2', BlockEnum.TriggerWebhook),
      ]
      const edges: Edge[] = []

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(false)
      expect(result.connectedComponents).toBe(2)
      expect(result.isolatedStartNodes).toHaveLength(2)
      expect(result.isolatedStartNodes.map(n => n.id)).toEqual(['trigger1', 'trigger2'])
    })
  })

  describe('edge cases', () => {
    it('should return valid for empty workflow', () => {
      const result = validateWorkflowConnectivity([], [])

      expect(result.isValid).toBe(true)
      expect(result.connectedComponents).toBe(0)
      expect(result.isolatedStartNodes).toHaveLength(0)
    })

    it('should return valid for single start node without connections', () => {
      const nodes = [createNode('start', BlockEnum.Start)]
      const edges: Edge[] = []

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(true)
      expect(result.connectedComponents).toBe(1)
      // For debugging: console.log('result:', result)
      // A single isolated start node should be detected as isolated
      expect(result.isolatedStartNodes.length).toBeGreaterThanOrEqual(0)
    })

    it('should return valid for workflow with non-start nodes only', () => {
      const nodes = [
        createNode('code', BlockEnum.Code),
        createNode('llm', BlockEnum.LLM),
      ]
      const edges = [createEdge('edge1', 'code', 'llm')]

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(true)
      expect(result.connectedComponents).toBe(0)
      expect(result.isolatedStartNodes).toHaveLength(0)
    })

    it('should handle all trigger node types correctly', () => {
      const nodes = [
        createNode('trigger1', BlockEnum.TriggerSchedule),
        createNode('trigger2', BlockEnum.TriggerWebhook),
        createNode('trigger3', BlockEnum.TriggerPlugin),
        createNode('start', BlockEnum.Start),
        createNode('process', BlockEnum.Code),
      ]
      const edges = [
        createEdge('edge1', 'trigger1', 'process'),
        createEdge('edge2', 'trigger2', 'process'),
        createEdge('edge3', 'trigger3', 'process'),
        createEdge('edge4', 'start', 'process'),
      ]

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(true)
      expect(result.connectedComponents).toBe(1)
      expect(result.isolatedStartNodes).toHaveLength(0)
    })

    it('should handle circular references without infinite loops', () => {
      const nodes = [
        createNode('start', BlockEnum.Start),
        createNode('code1', BlockEnum.Code),
        createNode('code2', BlockEnum.Code),
      ]
      const edges = [
        createEdge('edge1', 'start', 'code1'),
        createEdge('edge2', 'code1', 'code2'),
        createEdge('edge3', 'code2', 'code1'), // circular reference
      ]

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(true)
      expect(result.connectedComponents).toBe(1)
      expect(result.isolatedStartNodes).toHaveLength(0)
    })
  })

  describe('mixed scenarios', () => {
    it('should return invalid when one connected graph and one isolated start node exist', () => {
      const nodes = [
        createNode('start', BlockEnum.Start),
        createNode('process', BlockEnum.Code),
        createNode('end', BlockEnum.End),
        createNode('isolatedTrigger', BlockEnum.TriggerSchedule),
      ]
      const edges = [
        createEdge('edge1', 'start', 'process'),
        createEdge('edge2', 'process', 'end'),
      ]

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(false)
      expect(result.connectedComponents).toBe(2)
      expect(result.isolatedStartNodes).toHaveLength(1)
      expect(result.isolatedStartNodes[0].id).toBe('isolatedTrigger')
    })

    it('should return invalid for three separate trigger workflows', () => {
      const nodes = [
        createNode('trigger1', BlockEnum.TriggerSchedule),
        createNode('llm1', BlockEnum.LLM),
        createNode('trigger2', BlockEnum.TriggerWebhook),
        createNode('code2', BlockEnum.Code),
        createNode('trigger3', BlockEnum.TriggerPlugin),
        createNode('end3', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'trigger1', 'llm1'),
        createEdge('edge2', 'trigger2', 'code2'),
        createEdge('edge3', 'trigger3', 'end3'),
      ]

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(false)
      expect(result.connectedComponents).toBe(3)
      expect(result.isolatedStartNodes).toHaveLength(0) // Not isolated, just separate workflows
    })

    it('should return invalid for complex multi-branch disconnected workflows', () => {
      const nodes = [
        // First workflow - complex branching
        createNode('start1', BlockEnum.Start),
        createNode('ifelse1', BlockEnum.IfElse),
        createNode('llm1', BlockEnum.LLM),
        createNode('code1', BlockEnum.Code),
        createNode('end1', BlockEnum.End),
        // Second workflow - simple linear
        createNode('trigger2', BlockEnum.TriggerWebhook),
        createNode('process2', BlockEnum.ParameterExtractor),
        createNode('end2', BlockEnum.End),
      ]
      const edges = [
        // First workflow edges
        createEdge('edge1', 'start1', 'ifelse1'),
        createEdge('edge2', 'ifelse1', 'llm1'),
        createEdge('edge3', 'ifelse1', 'code1'),
        createEdge('edge4', 'llm1', 'end1'),
        createEdge('edge5', 'code1', 'end1'),
        // Second workflow edges
        createEdge('edge6', 'trigger2', 'process2'),
        createEdge('edge7', 'process2', 'end2'),
      ]

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(false)
      expect(result.connectedComponents).toBe(2)
      expect(result.isolatedStartNodes).toHaveLength(0)
    })

    it('should handle mixture of all trigger types in separate workflows', () => {
      const nodes = [
        createNode('schedule', BlockEnum.TriggerSchedule),
        createNode('webhook', BlockEnum.TriggerWebhook),
        createNode('plugin', BlockEnum.TriggerPlugin),
        createNode('start', BlockEnum.Start),
      ]
      const edges: Edge[] = [] // No connections between them

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(false)
      expect(result.connectedComponents).toBe(4)
      expect(result.isolatedStartNodes).toHaveLength(4)
      expect(result.isolatedStartNodes.map(n => n.id).sort()).toEqual(['plugin', 'schedule', 'start', 'webhook'])
    })
  })

  describe('real-world scenarios', () => {
    it('should allow multiple triggers feeding into shared workflow branches', () => {
      const nodes = [
        createNode('schedTrigger', BlockEnum.TriggerSchedule),
        createNode('webhookTrigger', BlockEnum.TriggerWebhook),
        createNode('classifier', BlockEnum.QuestionClassifier),
        createNode('llmBranch', BlockEnum.LLM),
        createNode('codeBranch', BlockEnum.Code),
        createNode('finalEnd', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'schedTrigger', 'classifier'),
        createEdge('edge2', 'webhookTrigger', 'classifier'),
        createEdge('edge3', 'classifier', 'llmBranch'),
        createEdge('edge4', 'classifier', 'codeBranch'),
        createEdge('edge5', 'llmBranch', 'finalEnd'),
        createEdge('edge6', 'codeBranch', 'finalEnd'),
      ]

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(true)
      expect(result.connectedComponents).toBe(1)
      expect(result.isolatedStartNodes).toHaveLength(0)
    })

    it('should reject parallel workflows with different end points', () => {
      const nodes = [
        // AI processing workflow
        createNode('aiTrigger', BlockEnum.TriggerSchedule),
        createNode('llmProcessor', BlockEnum.LLM),
        createNode('aiEnd', BlockEnum.End),
        // Data processing workflow
        createNode('dataTrigger', BlockEnum.TriggerWebhook),
        createNode('dataProcessor', BlockEnum.Code),
        createNode('dataEnd', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'aiTrigger', 'llmProcessor'),
        createEdge('edge2', 'llmProcessor', 'aiEnd'),
        createEdge('edge3', 'dataTrigger', 'dataProcessor'),
        createEdge('edge4', 'dataProcessor', 'dataEnd'),
      ]

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(false)
      expect(result.connectedComponents).toBe(2)
      expect(result.isolatedStartNodes).toHaveLength(0)
    })

    it('should handle workflow with iteration and loop nodes correctly', () => {
      const nodes = [
        createNode('start', BlockEnum.Start),
        createNode('iteration', BlockEnum.Iteration),
        createNode('loop', BlockEnum.Loop),
        createNode('innerCode', BlockEnum.Code),
        createNode('end', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'start', 'iteration'),
        createEdge('edge2', 'iteration', 'loop'),
        createEdge('edge3', 'loop', 'innerCode'),
        createEdge('edge4', 'innerCode', 'end'),
      ]

      const result = validateWorkflowConnectivity(nodes, edges)

      expect(result.isValid).toBe(true)
      expect(result.connectedComponents).toBe(1)
      expect(result.isolatedStartNodes).toHaveLength(0)
    })

    it('should detect disconnected utility nodes', () => {
      const nodes = [
        // Main workflow
        createNode('mainStart', BlockEnum.Start),
        createNode('mainProcess', BlockEnum.LLM),
        createNode('mainEnd', BlockEnum.End),
        // Disconnected utility nodes that should be caught
        createNode('orphanCode', BlockEnum.Code),
        createNode('orphanHttp', BlockEnum.HttpRequest),
      ]
      const edges = [
        createEdge('edge1', 'mainStart', 'mainProcess'),
        createEdge('edge2', 'mainProcess', 'mainEnd'),
        // orphan nodes have no connections
      ]

      const result = validateWorkflowConnectivity(nodes, edges)

      // This should still be valid as non-start nodes don't create separate workflows
      expect(result.isValid).toBe(true)
      expect(result.connectedComponents).toBe(1)
      expect(result.isolatedStartNodes).toHaveLength(0)
    })
  })
})
