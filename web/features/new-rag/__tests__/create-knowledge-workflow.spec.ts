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
      control_space_id: 'control-space-1',
      operation_id: 'operation-1',
      state: 'provisioning',
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
      operation_id: 'operation-1',
      state: 'provisioning',
    })
  })

  it('requires both default models before creating the control space', async () => {
    serviceMock.getDefaultModel.mockImplementation(
      ({ query }: { query: { model_type: 'llm' | 'text-embedding' } }) =>
        Promise.resolve(
          query.model_type === 'llm'
            ? {
                data: {
                  model: 'reasoning-model',
                  provider: { provider: 'langgenius/openai/openai' },
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
    ).rejects.toMatchObject({ name: 'KnowledgeCreationError', stage: 'preflight' })
    expect(serviceMock.createSpace).not.toHaveBeenCalled()
  })
})

describe('isDefinitiveCreationRejection', () => {
  it('only treats client authorization and validation failures as definitive', () => {
    expect(isDefinitiveCreationRejection({ status: 422 })).toBe(true)
    expect(isDefinitiveCreationRejection({ status: 503 })).toBe(false)
  })
})
