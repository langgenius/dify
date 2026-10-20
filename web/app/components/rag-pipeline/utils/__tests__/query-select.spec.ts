import { describe, expect, it } from 'vite-plus/test'
import { BlockEnum } from '@/app/components/workflow/types'
import { ChunkingMode } from '@/models/datasets'
import { DatasourceType, PipelineInputVarType } from '@/models/pipeline'
import {
  isPipelineProcessingRun,
  selectDatasourceSingleRun,
  selectPipelineExecutionLog,
  selectPipelineStepParameters,
  selectPipelineTemplate,
  selectPipelineTemplateList,
  selectPreviewRunEstimate,
  selectPublishedPipelineNodes,
} from '../query-select'

const graphNode = { id: 'node-1', data: { type: 'datasource' }, position: { x: 0, y: 0 } }

describe('pipeline query selectors', () => {
  it('should narrow template icons and chunk structures', () => {
    const { pipeline_templates } = selectPipelineTemplateList({
      pipeline_templates: [
        {
          id: 'template-1',
          name: 'Template',
          description: '',
          position: 1,
          chunk_structure: 'hierarchical_model',
          icon: { icon_type: 'emoji', icon: '📚', icon_background: '#fff' },
        },
        {
          id: 'template-2',
          name: 'Legacy',
          description: '',
          position: 2,
          chunk_structure: '',
          icon: { icon_type: 'unknown' },
        },
      ],
    })

    expect(pipeline_templates[0]).toMatchObject({
      chunk_structure: ChunkingMode.parentChild,
      icon: { icon_type: 'emoji', icon: '📚', icon_background: '#fff' },
    })
    expect(pipeline_templates[1]).toMatchObject({
      chunk_structure: ChunkingMode.text,
      icon: { icon_type: 'emoji', icon: '' },
    })
  })

  it('should keep only placeable graph nodes and edges', () => {
    const template = selectPipelineTemplate({
      id: 'template-1',
      name: 'Template',
      description: '',
      export_data: 'dsl',
      chunk_structure: 'text_model',
      icon_info: {},
      graph: {
        nodes: [graphNode, { id: 'broken' }],
        edges: [{ id: 'edge-1', source: 'a', target: 'b' }, { id: 'broken' }],
      },
    })

    expect(template.graph.nodes).toEqual([graphNode])
    expect(template.graph.edges).toEqual([{ id: 'edge-1', source: 'a', target: 'b' }])
    expect(template.graph.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(template.created_by).toBe('')
  })

  it('should read published pipeline nodes from the workflow graph', () => {
    expect(
      selectPublishedPipelineNodes({
        id: 'workflow-1',
        graph: { nodes: [graphNode] },
        features: {},
        hash: 'hash',
        version: 'v1',
        marked_name: '',
        marked_comment: '',
        created_at: 0,
        updated_at: 0,
        tool_published: false,
        environment_variables: [],
        conversation_variables: [],
        rag_pipeline_variables: [],
      }),
    ).toEqual([graphNode])
  })

  it('returns no nodes when the pipeline has no published workflow', () => {
    expect(selectPublishedPipelineNodes(null)).toEqual([])
  })

  it('should drop variables of unsupported types and unknown upload settings', () => {
    const { variables } = selectPipelineStepParameters({
      variables: [
        {
          belong_to_node_id: 'shared',
          type: 'file',
          label: 'File',
          variable: 'file',
          required: true,
          default_value: 3,
          allowed_file_types: ['document', 'spreadsheet'],
          allowed_file_upload_methods: ['local_file', 'ftp'],
          placeholder: null,
        },
        {
          belong_to_node_id: 'shared',
          type: 'json',
          label: 'JSON',
          variable: 'json',
          required: false,
        },
      ],
    })

    expect(variables).toEqual([
      expect.objectContaining({
        type: PipelineInputVarType.singleFile,
        default_value: 3,
        allowed_file_types: ['document'],
        allowed_file_upload_methods: ['local_file'],
        placeholder: undefined,
      }),
    ])
  })

  it('should default missing execution log fields', () => {
    expect(
      selectPipelineExecutionLog({ datasource_info: 'x', datasource_type: 'unknown' }),
    ).toEqual({
      datasource_info: {},
      input_data: {},
      datasource_node_id: '',
      datasource_type: DatasourceType.localFile,
    })
  })

  it('should tell processing runs from preview runs', () => {
    const batch = {
      batch: 'batch-1',
      dataset: { id: 'dataset-1', name: 'Dataset', chunk_structure: 'text_model' },
      documents: [],
    }
    const preview = {
      task_id: 'task-1',
      workflow_run_id: 'run-1',
      data: {
        id: 'run-1',
        workflow_id: 'workflow-1',
        status: 'succeeded' as const,
        elapsed_time: 1,
        total_tokens: 0,
        total_steps: 1,
        created_at: 0,
        finished_at: 1,
        outputs: { total_nodes: 1, total_segments: 2, preview: [] },
      },
    }

    expect(isPipelineProcessingRun(batch)).toBe(true)
    expect(isPipelineProcessingRun(preview)).toBe(false)
    expect(selectPreviewRunEstimate(preview)).toEqual(preview.data.outputs)
    expect(
      selectPreviewRunEstimate({ ...preview, data: { ...preview.data, outputs: { text: 'x' } } }),
    ).toBeUndefined()
  })

  it('should map a datasource single run to a node run result', () => {
    const result = selectDatasourceSingleRun({
      id: 'execution-1',
      node_type: 'not-a-block',
      status: 'succeeded',
      outputs: ['not', 'a', 'record'],
      execution_metadata: { total_tokens: 3 },
    })

    expect(result).toMatchObject({
      id: 'execution-1',
      node_type: BlockEnum.DataSource,
      status: 'succeeded',
      outputs: undefined,
      execution_metadata: { total_tokens: 3, total_price: 0, currency: '' },
      created_by: { id: '', name: '', email: '' },
    })
  })
})
