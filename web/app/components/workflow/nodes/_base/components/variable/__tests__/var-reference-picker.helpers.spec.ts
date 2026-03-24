import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { CommonNodeType, Node, ValueSelector } from '@/app/components/workflow/types'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { createLoopNode, createNode, createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import {
  getDynamicSelectSchema,
  getHasValue,
  getIsIterationVar,
  getIsLoopVar,
  getOutputVarNode,
  getOutputVarNodeId,
  getTooltipContent,
  getVarDisplayName,
  getVariableCategory,
  getVariableMeta,
  getWidthAllocations,
  isShowAPartSelector,
} from '../var-reference-picker.helpers'

describe('var-reference-picker.helpers', () => {
  it('should detect whether the picker has a variable value', () => {
    expect(getHasValue(false, ['node-1', 'answer'])).toBe(true)
    expect(getHasValue(true, 'constant')).toBe(false)
    expect(getHasValue(false, [])).toBe(false)
  })

  it('should detect iteration and loop variables by parent node id', () => {
    expect(getIsIterationVar(true, ['iter-parent', 'item'], 'iter-parent')).toBe(true)
    expect(getIsIterationVar(true, ['iter-parent', 'value'], 'iter-parent')).toBe(false)
    expect(getIsLoopVar(true, ['loop-parent', 'index'], 'loop-parent')).toBe(true)
    expect(getIsLoopVar(false, ['loop-parent', 'item'], 'loop-parent')).toBe(false)
  })

  it('should resolve output variable nodes for normal, system, iteration, and loop variables', () => {
    const startNode = createStartNode({ id: 'start-1', data: { title: 'Start Node' } })
    const normalNode = createNode({ id: 'node-a', data: { type: BlockEnum.Code, title: 'Answer Node' } })
    const iterationNode = createNode({ id: 'iter-parent', data: { type: BlockEnum.Iteration, title: 'Iteration Parent' } }) as Node<CommonNodeType>
    const loopNode = createLoopNode({ id: 'loop-parent', data: { title: 'Loop Parent' } }) as Node<CommonNodeType>

    expect(getOutputVarNode({
      availableNodes: [normalNode],
      hasValue: true,
      isConstant: false,
      isIterationVar: false,
      isLoopVar: false,
      iterationNode: null,
      loopNode: null,
      outputVarNodeId: 'node-a',
      startNode,
      value: ['node-a', 'answer'],
    })).toMatchObject({ id: 'node-a', title: 'Answer Node' })

    expect(getOutputVarNode({
      availableNodes: [normalNode],
      hasValue: true,
      isConstant: false,
      isIterationVar: false,
      isLoopVar: false,
      iterationNode: null,
      loopNode: null,
      outputVarNodeId: 'sys',
      startNode,
      value: ['sys', 'files'],
    })).toEqual(startNode.data)

    expect(getOutputVarNode({
      availableNodes: [normalNode],
      hasValue: true,
      isConstant: false,
      isIterationVar: true,
      isLoopVar: false,
      iterationNode,
      loopNode: null,
      outputVarNodeId: 'iter-parent',
      startNode,
      value: ['iter-parent', 'item'],
    })).toEqual(iterationNode.data)

    expect(getOutputVarNode({
      availableNodes: [normalNode],
      hasValue: true,
      isConstant: false,
      isIterationVar: false,
      isLoopVar: true,
      iterationNode: null,
      loopNode,
      outputVarNodeId: 'loop-parent',
      startNode,
      value: ['loop-parent', 'item'],
    })).toEqual(loopNode.data)

    expect(getOutputVarNode({
      availableNodes: [normalNode],
      hasValue: true,
      isConstant: false,
      isIterationVar: false,
      isLoopVar: false,
      iterationNode: null,
      loopNode: null,
      outputVarNodeId: 'missing-node',
      startNode,
      value: ['missing-node', 'answer'],
    })).toBeNull()
  })

  it('should format display names and output node ids correctly', () => {
    expect(getOutputVarNodeId(true, ['node-a', 'answer'])).toBe('node-a')
    expect(getOutputVarNodeId(false, [])).toBe('')

    expect(getVarDisplayName(true, ['sys', 'query'])).toBe('query')
    expect(getVarDisplayName(true, ['node-a', 'answer'])).toBe('answer')
    expect(getVarDisplayName(false, [])).toBe('')
  })

  it('should derive variable meta and category from selectors', () => {
    const meta = getVariableMeta({ type: BlockEnum.Code }, ['env', 'API_KEY'], 'API_KEY')
    expect(meta).toMatchObject({
      isEnv: true,
      isValidVar: true,
      isException: true,
    })

    expect(getVariableCategory({
      isChatVar: true,
      isEnv: false,
      isGlobal: false,
      isLoopVar: false,
      isRagVar: false,
    })).toBe('conversation')

    expect(getVariableCategory({
      isChatVar: false,
      isEnv: false,
      isGlobal: true,
      isLoopVar: false,
      isRagVar: false,
    })).toBe('global')

    expect(getVariableCategory({
      isChatVar: false,
      isEnv: false,
      isGlobal: false,
      isLoopVar: true,
      isRagVar: false,
    })).toBe('loop')

    expect(getVariableCategory({
      isChatVar: false,
      isEnv: true,
      isGlobal: false,
      isLoopVar: false,
      isRagVar: false,
    })).toBe('environment')

    expect(getVariableCategory({
      isChatVar: false,
      isEnv: false,
      isGlobal: false,
      isLoopVar: false,
      isRagVar: true,
    })).toBe('rag')
  })

  it('should calculate width allocations and tooltip behavior', () => {
    expect(getWidthAllocations(240, 'Node', 'answer', 'string')).toEqual({
      maxNodeNameWidth: expect.any(Number),
      maxTypeWidth: expect.any(Number),
      maxVarNameWidth: expect.any(Number),
    })

    expect(getTooltipContent(true, true, true)).toBe('full-path')
    expect(getTooltipContent(true, false, false)).toBe('invalid-variable')
    expect(getTooltipContent(false, false, true)).toBeNull()
  })

  it('should produce dynamic select schemas and detect partial selectors', () => {
    const value = 'selected'
    const schema: Partial<CredentialFormSchema> = {
      type: 'dynamic-select',
    } as Partial<CredentialFormSchema>

    expect(getDynamicSelectSchema({
      dynamicOptions: [{
        value: 'a',
        label: { en_US: 'A', zh_Hans: 'A' },
        show_on: [],
      }],
      isLoading: false,
      schema,
      value,
    })).toMatchObject({
      options: [{ value: 'a' }],
    })

    expect(getDynamicSelectSchema({
      dynamicOptions: null,
      isLoading: true,
      schema,
      value,
    })).toMatchObject({
      options: [{ value: 'selected' }],
    })

    expect(getDynamicSelectSchema({
      dynamicOptions: null,
      isLoading: false,
      schema,
      value,
    })).toMatchObject({ options: [] })

    expect(isShowAPartSelector(['node-a', 'payload', 'child'] as ValueSelector)).toBe(true)
    expect(isShowAPartSelector(['rag', 'node-a', 'payload'] as ValueSelector)).toBe(false)
  })

  it('should keep mapped variable names for known workflow aliases', () => {
    expect(getVarDisplayName(true, ['sys', 'files'])).toBe('files')
    expect(getVariableMeta({ type: VarType.string }, ['conversation', 'name'], 'name')).toMatchObject({
      isChatVar: true,
      isValidVar: true,
    })
  })

  it('should preserve non-dynamic schemas', () => {
    const schema: Partial<CredentialFormSchema> = {
      type: FormTypeEnum.textInput,
    }

    expect(getDynamicSelectSchema({
      dynamicOptions: null,
      isLoading: false,
      schema,
      value: '',
    })).toEqual(schema)
  })
})
