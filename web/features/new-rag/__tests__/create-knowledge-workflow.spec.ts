import { createKnowledge, isDefinitiveCreationRejection } from '../create-knowledge-workflow'

const serviceMock = vi.hoisted(() => ({
  createSpace: vi.fn(),
  getDefaultModel: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        post: serviceMock.createSpace,
      },
    },
    workspaces: {
      current: {
        defaultModel: {
          get: serviceMock.getDefaultModel,
        },
      },
    },
  },
}))

describe('createKnowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceMock.getDefaultModel.mockImplementation(
      ({ query }: { query: { model_type: 'llm' | 'text-embedding' } }) =>
        Promise.resolve({
          data: {
            model: query.model_type === 'llm' ? 'reasoning-model' : 'embedding-model',
            provider: {
              provider:
                query.model_type === 'llm'
                  ? 'langgenius/openai/openai'
                  : 'langgenius/cohere/cohere',
            },
          },
        }),
    )
    serviceMock.createSpace.mockResolvedValue({
      control_space_id: 'control-space-1',
      model_setup_required: false,
      operation_id: 'operation-1',
      state: 'provisioning',
    })
  })

  it('creates a control space with the new model intent and visibility', async () => {
    const onCreated = vi.fn()

    await expect(
      createKnowledge({
        description: 'Product docs',
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
        name: 'Dify Product Docs',
        onCreated,
        visibility: 'all_team_members',
      }),
    ).resolves.toEqual({
      knowledgeSpace: {
        control_space_id: 'control-space-1',
        model_setup_required: false,
        operation_id: 'operation-1',
        state: 'provisioning',
      },
      modelSetupRequired: false,
    })

    expect(serviceMock.createSpace).toHaveBeenCalledWith({
      body: {
        description: 'Product docs',
        embedding: {
          model: 'embedding-model',
          plugin_id: 'langgenius/cohere',
          provider: 'cohere',
        },
        idempotency_key: '11111111-1111-4111-8111-111111111111',
        name: 'Dify Product Docs',
        retrieval: {
          default_mode: 'fast',
          reasoning_model: {
            model: 'reasoning-model',
            plugin_id: 'langgenius/openai',
            provider: 'openai',
          },
          rerank: { enabled: false },
          score_threshold: { enabled: false, stage: 'mode-final' },
          top_k: 10,
        },
        slug: expect.stringMatching(/^dify-product-docs-[a-z0-9]+$/),
        visibility: 'all_team_members',
      },
    })
    expect(onCreated).toHaveBeenCalledWith({
      control_space_id: 'control-space-1',
      model_setup_required: false,
      operation_id: 'operation-1',
      state: 'provisioning',
    })
  })

  it.each(['text-embedding', 'llm'] as const)(
    'creates a setup-required control space when the default %s model is missing',
    async (missingModelType) => {
      serviceMock.createSpace.mockResolvedValueOnce({
        control_space_id: 'control-space-1',
        model_setup_required: true,
        operation_id: 'operation-1',
        state: 'provisioning',
      })
      serviceMock.getDefaultModel.mockImplementation(
        ({ query }: { query: { model_type: 'llm' | 'text-embedding' } }) =>
          Promise.resolve(
            query.model_type !== missingModelType
              ? {
                  data:
                    query.model_type === 'llm'
                      ? {
                          model: 'reasoning-model',
                          provider: { provider: 'langgenius/openai/openai' },
                        }
                      : {
                          model: 'embedding-model',
                          provider: { provider: 'langgenius/cohere/cohere' },
                        },
                }
              : { data: null },
          ),
      )

      await expect(
        createKnowledge({
          description: '',
          idempotencyKey: '22222222-2222-4222-8222-222222222222',
          name: '知识库',
          onCreated: vi.fn(),
          visibility: 'only_me',
        }),
      ).resolves.toEqual({
        knowledgeSpace: {
          control_space_id: 'control-space-1',
          model_setup_required: true,
          operation_id: 'operation-1',
          state: 'provisioning',
        },
        modelSetupRequired: true,
      })
      expect(serviceMock.createSpace).toHaveBeenCalledWith({
        body: {
          description: undefined,
          idempotency_key: '22222222-2222-4222-8222-222222222222',
          name: '知识库',
          slug: expect.stringMatching(/^knowledge-[a-z0-9]+$/),
          visibility: 'only_me',
        },
      })
    },
  )

  it('creates without model presets when loading workspace defaults fails', async () => {
    serviceMock.createSpace.mockResolvedValueOnce({
      control_space_id: 'control-space-1',
      model_setup_required: true,
      operation_id: 'operation-1',
      state: 'provisioning',
    })
    serviceMock.getDefaultModel.mockRejectedValue(new Error('model service unavailable'))

    await expect(
      createKnowledge({
        description: '',
        idempotencyKey: '33333333-3333-4333-8333-333333333333',
        name: 'Fallback',
        onCreated: vi.fn(),
        visibility: 'only_me',
      }),
    ).resolves.toMatchObject({ modelSetupRequired: true })

    expect(serviceMock.createSpace).toHaveBeenCalledWith({
      body: expect.not.objectContaining({
        embedding: expect.anything(),
        retrieval: expect.anything(),
      }),
    })
  })

  it('uses the persisted setup state returned by an idempotent replay', async () => {
    serviceMock.createSpace
      .mockRejectedValueOnce(new Error('response lost after creation'))
      .mockResolvedValueOnce({
        control_space_id: 'control-space-1',
        model_setup_required: true,
        operation_id: 'operation-1',
        state: 'provisioning',
      })

    const values = {
      description: '',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
      name: 'Recovered',
      onCreated: vi.fn(),
      visibility: 'only_me' as const,
    }

    await expect(createKnowledge(values)).rejects.toMatchObject({ stage: 'request' })
    await expect(createKnowledge(values)).resolves.toMatchObject({
      modelSetupRequired: true,
    })
  })
})

describe('isDefinitiveCreationRejection', () => {
  it('only treats client authorization and validation failures as definitive', () => {
    expect(isDefinitiveCreationRejection({ status: 422 })).toBe(true)
    expect(isDefinitiveCreationRejection({ status: 503 })).toBe(false)
  })
})
