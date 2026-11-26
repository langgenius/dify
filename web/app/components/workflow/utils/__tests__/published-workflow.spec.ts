import {
  toEnvironmentVariables,
  toFeaturesData,
  toGraphEdges,
  toGraphNodes,
  toPlacedGraphNodes,
  toStoredViewport,
  toViewport,
} from '../published-workflow'

describe('published workflow narrowing', () => {
  describe('graph', () => {
    it('keeps nodes and edges the canvas can load and drops malformed ones', () => {
      const node = {
        id: 'start',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: { title: 'Start' },
      }
      const edge = { id: 'start-end', source: 'start', target: 'end' }
      // Snapshots without coordinates are laid out when the canvas loads, so they are kept.
      const unplaced = { id: 'no-position', data: {} }
      const graph = {
        nodes: [node, unplaced, { id: 'no-data' }, 'not-a-node'],
        edges: [edge, { id: 'no-target', source: 'start' }],
      }

      expect(toGraphNodes(graph)).toEqual([node, unplaced])
      expect(toPlacedGraphNodes(graph)).toEqual([node])
      expect(toGraphEdges(graph)).toEqual([edge])
    })

    it('returns empty lists when the graph has no node or edge arrays', () => {
      expect(toGraphNodes({ nodes: {} })).toEqual([])
      expect(toGraphEdges({})).toEqual([])
    })

    it('reads the stored viewport and falls back to the default one', () => {
      expect(toViewport({ viewport: { x: 10, y: -5, zoom: 0.5 } })).toEqual({
        x: 10,
        y: -5,
        zoom: 0.5,
      })
      expect(toViewport({ viewport: { x: '10' } })).toEqual({ x: 0, y: 0, zoom: 1 })
      expect(toViewport({})).toEqual({ x: 0, y: 0, zoom: 1 })
    })

    it('returns no viewport when none is saved so the canvas keeps its current one', () => {
      expect(toStoredViewport({ viewport: { x: 10, y: -5, zoom: 0.5 } })).toEqual({
        x: 10,
        y: -5,
        zoom: 0.5,
      })
      expect(toStoredViewport({ viewport: { x: 10, y: -5 } })).toBeUndefined()
      expect(toStoredViewport({})).toBeUndefined()
    })
  })

  describe('environment variables', () => {
    it('keeps string, number, secret and LLM variables', () => {
      const llm = { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} }

      expect(
        toEnvironmentVariables([
          { id: '1', name: 'host', description: '', value: 'example.com', value_type: 'string' },
          { id: '2', name: 'retries', description: '', value: 3, value_type: 'number' },
          {
            id: '3',
            name: 'token',
            description: 'api',
            value: '[__HIDDEN__]',
            value_type: 'secret',
          },
          { id: '4', name: 'model', description: '', value: llm, value_type: 'llm' },
        ]),
      ).toEqual([
        { id: '1', name: 'host', description: '', value: 'example.com', value_type: 'string' },
        { id: '2', name: 'retries', description: '', value: 3, value_type: 'number' },
        { id: '3', name: 'token', description: 'api', value: '[__HIDDEN__]', value_type: 'secret' },
        { id: '4', name: 'model', description: '', value: llm, value_type: 'llm' },
      ])
    })

    it('drops variables of an unknown type or with a value the editor cannot hold', () => {
      expect(
        toEnvironmentVariables([
          { id: '1', name: 'flag', description: '', value: true, value_type: 'boolean' },
          {
            id: '2',
            name: 'model',
            description: '',
            value: { provider: 'openai' },
            value_type: 'llm',
          },
          { id: '3', name: 'empty', description: '', value: null, value_type: 'string' },
        ]),
      ).toEqual([])
    })
  })

  describe('features', () => {
    it('maps stored features to the feature panel state', () => {
      expect(
        toFeaturesData({
          opening_statement: 'Hi',
          suggested_questions: ['What can you do?', 42],
          suggested_questions_after_answer: {
            enabled: true,
            prompt: 'Suggest follow-ups',
            model: { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} },
          },
          text_to_speech: { enabled: true, language: 'en-US', voice: 'alloy', autoPlay: 'enabled' },
          speech_to_text: { enabled: false },
          retriever_resource: { enabled: true },
          sensitive_word_avoidance: { enabled: true, type: 'keywords', config: { keywords: 'x' } },
          file_upload: {
            enabled: true,
            image: {
              enabled: true,
              number_limits: 3,
              transfer_methods: ['local_file'],
              detail: 'high',
            },
            allowed_file_types: ['image'],
            allowed_file_extensions: ['.png'],
            allowed_file_upload_methods: ['remote_url', 'datasource_file', 'tool_file', 'ftp'],
            number_limits: 5,
          },
        }),
      ).toEqual({
        opening: {
          enabled: true,
          opening_statement: 'Hi',
          suggested_questions: ['What can you do?'],
        },
        suggested: {
          enabled: true,
          prompt: 'Suggest follow-ups',
          model: { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} },
        },
        text2speech: { enabled: true, language: 'en-US', voice: 'alloy', autoPlay: 'enabled' },
        speech2text: { enabled: false },
        citation: { enabled: true },
        moderation: { enabled: true, type: 'keywords', config: { keywords: 'x' } },
        file: expect.objectContaining({
          enabled: true,
          image: expect.objectContaining({
            enabled: true,
            number_limits: 3,
            transfer_methods: ['local_file'],
            detail: 'high',
          }),
          allowed_file_types: ['image'],
          allowed_file_extensions: ['.png'],
          allowed_file_upload_methods: ['remote_url', 'datasource_file', 'tool_file'],
          number_limits: 5,
        }),
      })
    })

    it('leaves absent features unset and disables the opening without a statement or questions', () => {
      expect(toFeaturesData({})).toEqual({
        opening: { enabled: false, opening_statement: undefined, suggested_questions: [] },
        suggested: undefined,
        text2speech: undefined,
        speech2text: undefined,
        citation: undefined,
        moderation: undefined,
        file: undefined,
      })
    })

    it('enables the opening when only suggested questions are stored', () => {
      expect(toFeaturesData({ suggested_questions: ['Start here'] }).opening).toEqual({
        enabled: true,
        opening_statement: undefined,
        suggested_questions: ['Start here'],
      })
    })
  })
})
