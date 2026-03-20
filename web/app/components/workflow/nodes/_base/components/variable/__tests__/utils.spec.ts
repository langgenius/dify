import type { StructuredOutput } from '@/app/components/workflow/nodes/llm/types'
import type { Node, ToolWithProvider, Var } from '@/app/components/workflow/types'
import type { SchemaTypeDefinition } from '@/service/use-common'
import { CollectionType } from '@/app/components/tools/types'
import { OUTPUT_FILE_SUB_VARIABLES } from '@/app/components/workflow/nodes/constants'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import ToolNodeDefault from '@/app/components/workflow/nodes/tool/default'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { toNodeAvailableVars } from '../utils'

const localizedText = {
  en_US: 'test',
  zh_Hans: 'test',
}

const fileSchemaDefinition = {
  name: 'file',
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      size: { type: 'number' },
      type: { type: 'string' },
      extension: { type: 'string' },
      mime_type: { type: 'string' },
      transfer_method: { type: 'string' },
      url: { type: 'string' },
      related_id: { type: 'string' },
    },
  },
} as unknown as SchemaTypeDefinition

const createToolNode = (): Node => {
  return {
    id: 'tool-node',
    position: { x: 0, y: 0 },
    data: {
      type: BlockEnum.Tool,
      title: 'File Tool',
      provider_id: 'provider',
      provider_type: CollectionType.builtIn,
      provider_name: 'Provider',
      tool_name: 'file_tool',
      tool_label: 'File Tool',
      tool_parameters: {},
      tool_configurations: {},
      tool_node_version: '2',
    },
  } as unknown as Node
}

const createToolCollection = (outputSchema: Record<string, unknown>): ToolWithProvider => {
  return {
    id: 'provider',
    name: 'Provider',
    author: 'Dify',
    description: localizedText,
    icon: '',
    label: localizedText,
    type: CollectionType.builtIn,
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: false,
    labels: [],
    tools: [
      {
        name: 'file_tool',
        author: 'Dify',
        label: localizedText,
        description: 'Test tool',
        parameters: [],
        labels: [],
        output_schema: outputSchema,
      },
    ],
    meta: {
      version: '',
    },
  }
}

const createPluginInfoList = (outputSchema: Record<string, unknown>) => {
  return {
    buildInTools: [createToolCollection(outputSchema)],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
    dataSourceList: [],
  }
}

const getToolOutputVar = (outputSchema: Record<string, unknown>, variable: string) => {
  const nodeVars = toNodeAvailableVars({
    beforeNodes: [createToolNode()],
    isChatMode: false,
    filterVar: () => true,
    allPluginInfoList: createPluginInfoList(outputSchema),
    schemaTypeDefinitions: [fileSchemaDefinition],
  }).find(item => item.nodeId === 'tool-node')

  return nodeVars?.vars.find(v => v.variable === variable)
}

const getChildVariables = (variable?: Var) => {
  if (!variable || !Array.isArray(variable.children))
    return []

  return variable.children.map(child => child.variable)
}

const createFileStructuredOutput = (
  extraProperties: StructuredOutput['schema']['properties'] = {},
): StructuredOutput => {
  return {
    schema: {
      type: Type.object,
      properties: {
        name: { type: Type.string },
        size: { type: Type.number },
        type: { type: Type.string },
        extension: { type: Type.string },
        mime_type: { type: Type.string },
        transfer_method: { type: Type.string },
        url: { type: Type.string },
        related_id: { type: Type.string },
        ...extraProperties,
      },
      additionalProperties: false,
    },
  }
}

describe('toNodeAvailableVars', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('file-like outputs', () => {
    it('should keep the standard file children when no extra fields exist', () => {
      const fileVar = getToolOutputVar({
        type: 'object',
        properties: {
          artifact: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              size: { type: 'number' },
              type: { type: 'string' },
              extension: { type: 'string' },
              mime_type: { type: 'string' },
              transfer_method: { type: 'string' },
              url: { type: 'string' },
              related_id: { type: 'string' },
            },
          },
        },
      }, 'artifact')

      const childVariables = getChildVariables(fileVar)

      expect(fileVar?.type).toBe(VarType.file)
      expect(childVariables).toEqual([...OUTPUT_FILE_SUB_VARIABLES, 'transfer_method'])
      expect(new Set(childVariables).size).toBe(childVariables.length)
    })

    it('should expose extra text children without duplicating standard file fields', () => {
      vi.spyOn(ToolNodeDefault, 'getOutputVars').mockReturnValue([
        {
          variable: 'artifact',
          type: VarType.file,
          children: createFileStructuredOutput({
            text: { type: Type.string },
          }),
        },
      ])

      const fileVar = getToolOutputVar({}, 'artifact')

      const childVariables = getChildVariables(fileVar)

      expect(fileVar?.type).toBe(VarType.file)
      expect(childVariables).toContain('text')
      expect(childVariables).toContain('transfer_method')
      expect(childVariables).toEqual([...OUTPUT_FILE_SUB_VARIABLES, 'transfer_method', 'text'])
      expect(new Set(childVariables).size).toBe(childVariables.length)
    })
  })

  describe('non-file outputs', () => {
    it('should keep non-file object children unchanged', () => {
      const objectVar = getToolOutputVar({
        type: 'object',
        properties: {
          metadata: {
            type: 'object',
            properties: {
              summary: { type: 'string' },
              count: { type: 'number' },
            },
          },
        },
      }, 'metadata')

      expect(objectVar?.type).toBe(VarType.object)
      expect(objectVar?.children).toEqual({
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            count: { type: 'number' },
          },
          additionalProperties: false,
        },
      })
    })
  })
})
