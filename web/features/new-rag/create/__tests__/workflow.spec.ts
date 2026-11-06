import { createHttpError } from '@/service/http-error'
import {
  createKnowledge,
  isDefinitiveCreationRejection,
  waitForKnowledgeSpaceReady,
} from '../workflow'

const serviceMock = vi.hoisted(() => ({
  createSpace: vi.fn(),
  getSpace: vi.fn(),
}))

vi.mock('@/service/console', () => ({
  consoleClient: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          get: serviceMock.getSpace,
        },
        post: serviceMock.createSpace,
      },
    },
  },
}))

const selectedModels = {
  reasoning: { model: 'reasoning-model', provider: 'langgenius/openai/openai' },
  embedding: { model: 'embedding-model', provider: 'langgenius/cohere/cohere' },
  rerank: { model: 'rerank-model', provider: 'langgenius/cohere/cohere' },
}

describe('createKnowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceMock.createSpace.mockResolvedValue({
      control_space_id: 'control-space-1',
      model_setup_required: false,
      operation_id: 'operation-1',
      state: 'provisioning',
    })
    serviceMock.getSpace.mockResolvedValue({
      control_space_id: 'control-space-1',
      created_at: '2026-08-10T09:45:02Z',
      knowledge_space_id: 'knowledge-space-1',
      owner_account_id: 'account-1',
      permission_keys: ['knowledge_space_read'],
      resource_version: 1,
      state: 'active',
      technical_status: 'available',
      technical_summary: null,
      updated_at: '2026-08-10T09:45:38Z',
      visibility: 'only_me',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates a control space with the new model intent and visibility', async () => {
    const onCreated = vi.fn()

    await expect(
      createKnowledge({
        description: 'Product docs',
        models: selectedModels,
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
          rerank: {
            enabled: true,
            model: {
              model: 'rerank-model',
              plugin_id: 'langgenius/cohere',
              provider: 'cohere',
            },
          },
          score_threshold: { enabled: false, stage: 'rerank' },
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

  it('rejects creation before the request when model selections are missing', async () => {
    await expect(
      createKnowledge({
        description: '',
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
        name: 'Knowledge',
        onCreated: vi.fn(),
        visibility: 'only_me',
      }),
    ).rejects.toMatchObject({ stage: 'preflight' })
    expect(serviceMock.createSpace).not.toHaveBeenCalled()
  })

  it('rejects an incomplete provider identity before creating a space', async () => {
    await expect(
      createKnowledge({
        description: '',
        idempotencyKey: '33333333-3333-4333-8333-333333333333',
        name: 'Knowledge',
        models: { ...selectedModels, reasoning: { model: 'reasoning-model', provider: '' } },
        onCreated: vi.fn(),
        visibility: 'only_me',
      }),
    ).rejects.toMatchObject({ stage: 'preflight' })
    expect(serviceMock.createSpace).not.toHaveBeenCalled()
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
      models: selectedModels,
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

  it('waits for an asynchronously provisioned space before allowing data-plane work', async () => {
    vi.useFakeTimers()
    serviceMock.getSpace
      .mockResolvedValueOnce({
        control_space_id: 'control-space-1',
        created_at: '2026-08-10T09:45:02Z',
        knowledge_space_id: null,
        owner_account_id: 'account-1',
        permission_keys: ['knowledge_space_read'],
        resource_version: 0,
        state: 'provisioning',
        technical_status: 'not_ready',
        technical_summary: null,
        updated_at: '2026-08-10T09:45:02Z',
        visibility: 'only_me',
      })
      .mockResolvedValueOnce({
        control_space_id: 'control-space-1',
        created_at: '2026-08-10T09:45:02Z',
        knowledge_space_id: 'knowledge-space-1',
        owner_account_id: 'account-1',
        permission_keys: ['knowledge_space_read'],
        resource_version: 1,
        state: 'active',
        technical_status: 'available',
        technical_summary: null,
        updated_at: '2026-08-10T09:45:38Z',
        visibility: 'only_me',
      })

    const ready = waitForKnowledgeSpaceReady('control-space-1')
    await Promise.resolve()

    expect(serviceMock.getSpace).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(ready).resolves.toMatchObject({
      knowledge_space_id: 'knowledge-space-1',
      state: 'active',
    })
    expect(serviceMock.getSpace).toHaveBeenCalledTimes(2)
  })
})

describe('isDefinitiveCreationRejection', () => {
  it('only treats client authorization and validation failures as definitive', () => {
    expect(
      isDefinitiveCreationRejection(createHttpError(new Response(null, { status: 422 }))),
    ).toBe(true)
    expect(
      isDefinitiveCreationRejection(createHttpError(new Response(null, { status: 503 }))),
    ).toBe(false)
  })
})
