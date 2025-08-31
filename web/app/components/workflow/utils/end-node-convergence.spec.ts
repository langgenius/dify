/**
 * END Node Convergence Validation Tests
 *
 * Tests for validateEndNodeConvergence function to ensure that multiple entry nodes
 * in the same connected graph don't point to different END nodes.
 */

import { validateEndNodeConvergence } from './workflow'
import { BlockEnum } from '../types'
import type { Edge, Node } from '../types'

describe('validateEndNodeConvergence', () => {
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

  describe('valid scenarios - should return isValid: true', () => {
    it('should return valid for empty workflow', () => {
      const result = validateEndNodeConvergence([], [])

      expect(result.isValid).toBe(true)
      expect(result.conflictingEntryNodes).toHaveLength(0)
      expect(result.reachableEndNodes).toHaveLength(0)
    })

    it('should return valid for single entry node', () => {
      const nodes = [
        createNode('start', BlockEnum.Start),
        createNode('llm', BlockEnum.LLM),
        createNode('end', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'start', 'llm'),
        createEdge('edge2', 'llm', 'end'),
      ]

      const result = validateEndNodeConvergence(nodes, edges)

      expect(result.isValid).toBe(true)
    })

    it('should return valid for single entry node with multiple END nodes (parallel branches)', () => {
      const nodes = [
        createNode('start', BlockEnum.Start),
        createNode('ifelse', BlockEnum.IfElse),
        createNode('end1', BlockEnum.End),
        createNode('end2', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'start', 'ifelse'),
        createEdge('edge2', 'ifelse', 'end1'),
        createEdge('edge3', 'ifelse', 'end2'),
      ]

      const result = validateEndNodeConvergence(nodes, edges)

      expect(result.isValid).toBe(true)
    })

    it('should return valid for multiple entry nodes in same connected graph pointing to same END node', () => {
      const nodes = [
        createNode('start', BlockEnum.Start),
        createNode('trigger', BlockEnum.TriggerSchedule),
        createNode('llm', BlockEnum.LLM),
        createNode('end', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'start', 'llm'),
        createEdge('edge2', 'trigger', 'llm'),
        createEdge('edge3', 'llm', 'end'),
      ]

      const result = validateEndNodeConvergence(nodes, edges)

      expect(result.isValid).toBe(true)
    })

    it('should return valid for multiple entry nodes in different connected graphs with different END nodes', () => {
      const nodes = [
        // Graph 1
        createNode('start', BlockEnum.Start),
        createNode('end1', BlockEnum.End),
        // Graph 2
        createNode('trigger', BlockEnum.TriggerWebhook),
        createNode('llm', BlockEnum.LLM),
        createNode('end2', BlockEnum.End),
      ]
      const edges = [
        // Graph 1 edges
        createEdge('edge1', 'start', 'end1'),
        // Graph 2 edges
        createEdge('edge2', 'trigger', 'llm'),
        createEdge('edge3', 'llm', 'end2'),
      ]

      const result = validateEndNodeConvergence(nodes, edges)

      expect(result.isValid).toBe(true)
    })

    it('should return valid for complex valid scenario with multiple triggers converging to same END', () => {
      const nodes = [
        createNode('trigger1', BlockEnum.TriggerSchedule),
        createNode('trigger2', BlockEnum.TriggerWebhook),
        createNode('trigger3', BlockEnum.TriggerPlugin),
        createNode('start', BlockEnum.Start),
        createNode('llm1', BlockEnum.LLM),
        createNode('llm2', BlockEnum.LLM),
        createNode('end', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'trigger1', 'llm1'),
        createEdge('edge2', 'trigger2', 'llm1'),
        createEdge('edge3', 'trigger3', 'llm2'),
        createEdge('edge4', 'start', 'llm2'),
        createEdge('edge5', 'llm1', 'end'),
        createEdge('edge6', 'llm2', 'end'),
      ]

      const result = validateEndNodeConvergence(nodes, edges)

      expect(result.isValid).toBe(true)
    })
  })

  describe('invalid scenarios - should return isValid: false', () => {
    it('should return invalid for multiple entry nodes in same connected graph pointing to different END nodes', () => {
      const nodes = [
        createNode('start', BlockEnum.Start),
        createNode('trigger', BlockEnum.TriggerSchedule),
        createNode('llm', BlockEnum.LLM),
        createNode('end1', BlockEnum.End),
        createNode('end2', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'start', 'end1'),
        createEdge('edge2', 'trigger', 'llm'),
        createEdge('edge3', 'llm', 'end2'),
        createEdge('edge4', 'start', 'llm'), // This connects the graphs
      ]

      const result = validateEndNodeConvergence(nodes, edges)

      expect(result.isValid).toBe(false)
      expect(result.conflictingEntryNodes).toHaveLength(2)
      expect(result.conflictingEntryNodes.map(n => n.id).sort()).toEqual(['start', 'trigger'])
      expect(result.reachableEndNodes).toHaveLength(2)
    })

    it('should return invalid for three entry nodes with conflicting END nodes', () => {
      const nodes = [
        createNode('start', BlockEnum.Start),
        createNode('trigger1', BlockEnum.TriggerSchedule),
        createNode('trigger2', BlockEnum.TriggerWebhook),
        createNode('code', BlockEnum.Code),
        createNode('llm', BlockEnum.LLM),
        createNode('end1', BlockEnum.End),
        createNode('end2', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'start', 'code'),
        createEdge('edge2', 'trigger1', 'code'),
        createEdge('edge3', 'trigger2', 'llm'),
        createEdge('edge4', 'code', 'end1'),
        createEdge('edge5', 'llm', 'end2'),
        // Connect all entry nodes to same graph
        createEdge('edge6', 'code', 'llm'),
      ]

      const result = validateEndNodeConvergence(nodes, edges)

      expect(result.isValid).toBe(false)
      expect(result.conflictingEntryNodes).toHaveLength(3)
    })

    it('should return invalid for complex branching scenario with conflicting END nodes', () => {
      const nodes = [
        createNode('start', BlockEnum.Start),
        createNode('trigger', BlockEnum.TriggerPlugin),
        createNode('ifelse', BlockEnum.IfElse),
        createNode('llm1', BlockEnum.LLM),
        createNode('llm2', BlockEnum.LLM),
        createNode('end1', BlockEnum.End),
        createNode('end2', BlockEnum.End),
        createNode('end3', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'start', 'ifelse'),
        createEdge('edge2', 'trigger', 'llm1'),
        createEdge('edge3', 'ifelse', 'llm2'),
        createEdge('edge4', 'ifelse', 'end1'),
        createEdge('edge5', 'llm1', 'end2'),
        createEdge('edge6', 'llm2', 'end3'),
        createEdge('edge7', 'llm1', 'llm2'), // This connects the subgraphs
      ]

      const result = validateEndNodeConvergence(nodes, edges)

      expect(result.isValid).toBe(false)
      expect(result.conflictingEntryNodes).toHaveLength(2)
    })
  })

  describe('edge cases', () => {
    it('should handle workflow with no END nodes', () => {
      const nodes = [
        createNode('start', BlockEnum.Start),
        createNode('llm', BlockEnum.LLM),
      ]
      const edges = [
        createEdge('edge1', 'start', 'llm'),
      ]

      const result = validateEndNodeConvergence(nodes, edges)

      expect(result.isValid).toBe(true)
    })

    it('should handle multiple entry nodes with no connections', () => {
      const nodes = [
        createNode('start', BlockEnum.Start),
        createNode('trigger1', BlockEnum.TriggerSchedule),
        createNode('trigger2', BlockEnum.TriggerWebhook),
      ]
      const edges: Edge[] = []

      const result = validateEndNodeConvergence(nodes, edges)

      expect(result.isValid).toBe(true)
    })

    it('should handle circular references correctly', () => {
      const nodes = [
        createNode('start', BlockEnum.Start),
        createNode('trigger', BlockEnum.TriggerSchedule),
        createNode('code1', BlockEnum.Code),
        createNode('code2', BlockEnum.Code),
        createNode('end', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'start', 'code1'),
        createEdge('edge2', 'trigger', 'code2'),
        createEdge('edge3', 'code1', 'code2'),
        createEdge('edge4', 'code2', 'code1'), // circular reference
        createEdge('edge5', 'code1', 'end'),
      ]

      const result = validateEndNodeConvergence(nodes, edges)

      expect(result.isValid).toBe(true)
    })

    it('should handle all trigger node types correctly', () => {
      const nodes = [
        createNode('trigger1', BlockEnum.TriggerSchedule),
        createNode('trigger2', BlockEnum.TriggerWebhook),
        createNode('trigger3', BlockEnum.TriggerPlugin),
        createNode('llm', BlockEnum.LLM),
        createNode('code', BlockEnum.Code),
        createNode('end1', BlockEnum.End),
        createNode('end2', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'trigger1', 'llm'),
        createEdge('edge2', 'trigger2', 'llm'),
        createEdge('edge3', 'trigger3', 'code'),
        createEdge('edge4', 'llm', 'end1'),
        createEdge('edge5', 'code', 'end2'),
        // Connect all triggers to same graph
        createEdge('edge6', 'llm', 'code'),
      ]

      const result = validateEndNodeConvergence(nodes, edges)

      expect(result.isValid).toBe(false)
      expect(result.conflictingEntryNodes).toHaveLength(3)
    })
  })

  describe('real-world scenarios', () => {
    it('should allow single entry with complex branching to multiple END nodes', () => {
      const nodes = [
        createNode('start', BlockEnum.Start),
        createNode('classifier', BlockEnum.QuestionClassifier),
        createNode('llm1', BlockEnum.LLM),
        createNode('llm2', BlockEnum.LLM),
        createNode('code', BlockEnum.Code),
        createNode('end1', BlockEnum.End),
        createNode('end2', BlockEnum.End),
        createNode('end3', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'start', 'classifier'),
        createEdge('edge2', 'classifier', 'llm1'),
        createEdge('edge3', 'classifier', 'llm2'),
        createEdge('edge4', 'classifier', 'code'),
        createEdge('edge5', 'llm1', 'end1'),
        createEdge('edge6', 'llm2', 'end2'),
        createEdge('edge7', 'code', 'end3'),
      ]

      const result = validateEndNodeConvergence(nodes, edges)

      expect(result.isValid).toBe(true)
    })

    it('should reject multiple triggers in connected graph with different endpoints', () => {
      const nodes = [
        createNode('schedTrigger', BlockEnum.TriggerSchedule),
        createNode('webhookTrigger', BlockEnum.TriggerWebhook),
        createNode('userStart', BlockEnum.Start),
        createNode('sharedProcessor', BlockEnum.LLM),
        createNode('aiEnd', BlockEnum.End),
        createNode('webhookEnd', BlockEnum.End),
        createNode('userEnd', BlockEnum.End),
      ]
      const edges = [
        createEdge('edge1', 'schedTrigger', 'sharedProcessor'),
        createEdge('edge2', 'webhookTrigger', 'webhookEnd'),
        createEdge('edge3', 'userStart', 'userEnd'),
        createEdge('edge4', 'sharedProcessor', 'aiEnd'),
        // Connect all subgraphs
        createEdge('edge5', 'sharedProcessor', 'webhookEnd'),
        createEdge('edge6', 'userStart', 'sharedProcessor'),
      ]

      const result = validateEndNodeConvergence(nodes, edges)

      expect(result.isValid).toBe(false)
      expect(result.conflictingEntryNodes).toHaveLength(3)
    })
  })
})
