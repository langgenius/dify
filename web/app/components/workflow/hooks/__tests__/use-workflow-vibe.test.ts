
import { describe, it, expect } from 'vitest'
import { replaceVariableReferences } from '../use-workflow-vibe'
import { BlockEnum } from '@/app/components/workflow/types'

// Mock types needed for the test
interface NodeData {
    title: string
    [key: string]: any
}

describe('use-workflow-vibe', () => {
    describe('replaceVariableReferences', () => {
        it('should replace variable references in strings', () => {
            const data = {
                title: 'Test Node',
                prompt: 'Hello {{#old_id.query#}}',
            }
            const nodeIdMap = new Map<string, any>()
            nodeIdMap.set('old_id', { id: 'new_uuid', data: { type: 'llm' } })

            const result = replaceVariableReferences(data, nodeIdMap) as NodeData
            expect(result.prompt).toBe('Hello {{#new_uuid.query#}}')
        })

        it('should handle multiple references in one string', () => {
            const data = {
                title: 'Test Node',
                text: '{{#node1.out#}} and {{#node2.out#}}',
            }
            const nodeIdMap = new Map<string, any>()
            nodeIdMap.set('node1', { id: 'uuid1', data: { type: 'llm' } })
            nodeIdMap.set('node2', { id: 'uuid2', data: { type: 'llm' } })

            const result = replaceVariableReferences(data, nodeIdMap) as NodeData
            expect(result.text).toBe('{{#uuid1.out#}} and {{#uuid2.out#}}')
        })

        it('should replace variable references in value_selector arrays', () => {
            const data = {
                title: 'End Node',
                outputs: [
                    {
                        variable: 'result',
                        value_selector: ['old_id', 'text'],
                    },
                ],
            }
            const nodeIdMap = new Map<string, any>()
            nodeIdMap.set('old_id', { id: 'new_uuid', data: { type: 'llm' } })

            const result = replaceVariableReferences(data, nodeIdMap) as NodeData
            expect(result.outputs[0].value_selector).toEqual(['new_uuid', 'text'])
        })

        it('should handle nested objects recursively', () => {
            const data = {
                config: {
                    model: {
                        prompt: '{{#old_id.text#}}',
                    },
                },
            }
            const nodeIdMap = new Map<string, any>()
            nodeIdMap.set('old_id', { id: 'new_uuid', data: { type: 'llm' } })

            const result = replaceVariableReferences(data, nodeIdMap) as any
            expect(result.config.model.prompt).toBe('{{#new_uuid.text#}}')
        })

        it('should ignoring missing node mappings', () => {
            const data = {
                text: '{{#missing_id.text#}}',
            }
            const nodeIdMap = new Map<string, any>()
            // missing_id is not in map

            const result = replaceVariableReferences(data, nodeIdMap) as NodeData
            expect(result.text).toBe('{{#missing_id.text#}}')
        })
    })
})
