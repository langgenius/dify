import type { Parameters as TryAppParameters } from '@dify/contracts/api/console/trial-apps/types.gen'
import { consoleClient } from '@/service/client'
import { Resolution, TransferMethod, TtsAutoPlay } from '@/types/app'
import {
  fetchTryAppDatasets,
  fetchTryAppFlowPreview,
  fetchTryAppInfo,
  fetchTryAppParams,
} from './try-app'

vi.mock('@/service/client', () => ({
  consoleClient: {
    trialApps: {
      byAppId: {
        get: vi.fn(),
        datasets: {
          get: vi.fn(),
        },
        parameters: {
          get: vi.fn(),
        },
        workflows: {
          get: vi.fn(),
        },
      },
    },
  },
}))

const baseTryAppParameters = (overrides: Partial<TryAppParameters> = {}): TryAppParameters => ({
  annotation_reply: {
    id: 'annotation-1',
    enabled: true,
    score_threshold: 0.65,
    embedding_model: {
      embedding_provider_name: 'openai',
      embedding_model_name: 'text-embedding-3-large',
    },
  },
  file_upload: {
    image: {
      enabled: true,
      number_limits: 5,
      detail: Resolution.low,
      transfer_methods: [TransferMethod.remote_url],
    },
    allowed_upload_methods: [TransferMethod.local_file],
    allowed_file_upload_methods: [TransferMethod.remote_url],
    allowed_file_types: ['image'],
    allowed_file_extensions: ['.png'],
    max_length: 2,
    number_limits: 3,
  },
  more_like_this: {
    enabled: true,
  },
  opening_statement: 'Hello',
  retriever_resource: {
    enabled: true,
  },
  sensitive_word_avoidance: {
    enabled: true,
  },
  speech_to_text: {
    enabled: true,
  },
  suggested_questions: ['Question 1'],
  suggested_questions_after_answer: {
    enabled: true,
  },
  system_parameters: {
    audio_file_size_limit: 10,
    file_size_limit: 20,
    image_file_size_limit: 30,
    video_file_size_limit: 40,
    workflow_file_upload_limit: 50,
  },
  text_to_speech: {
    enabled: true,
    voice: 'alloy',
    language: 'en-US',
    autoPlay: TtsAutoPlay.enabled,
  },
  user_input_form: [
    {
      'text-input': {
        label: 'Name',
        variable: 'name',
        required: true,
        max_length: 48,
      },
    },
    {
      select: {
        label: 'Priority',
        variable: 'priority',
        required: false,
        options: ['low', 'high', 1],
      },
    },
    {
      external_data_tool: {
        label: 'Lookup',
        variable: 'lookup',
        required: true,
        enabled: true,
        type: 'api',
        icon: 'search',
        icon_background: '#fff',
        config: {
          endpoint: '/lookup',
          ignored: 1,
        },
      },
    },
    {
      json_object: {
        label: 'Payload',
        variable: 'payload',
        required: true,
        json_schema: {
          type: 'object',
        },
      },
    },
  ],
  ...overrides,
})

describe('try app service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches app info through the generated trial app detail contract', async () => {
    vi.mocked(consoleClient.trialApps.byAppId.get).mockResolvedValue({
      enable_api: true,
      enable_site: true,
      id: 'app-1',
      mode: 'chat',
      name: 'App',
      site: {
        chat_color_theme_inverted: false,
        default_language: 'en-US',
        show_workflow_steps: false,
        title: 'App',
        use_icon_as_answer_icon: false,
      },
    })

    await fetchTryAppInfo('app-1')

    expect(consoleClient.trialApps.byAppId.get).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
    })
  })

  it('fetches app workflow preview through the generated workflow contract', async () => {
    vi.mocked(consoleClient.trialApps.byAppId.workflows.get).mockResolvedValue({
      graph: {
        edges: [],
        nodes: [],
        viewport: {
          x: 0,
          y: 0,
          zoom: 1,
        },
      },
      id: 'workflow-1',
    })

    await fetchTryAppFlowPreview('app-1')

    expect(consoleClient.trialApps.byAppId.workflows.get).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
    })
  })

  it('serializes dataset ids through the generated datasets contract', async () => {
    vi.mocked(consoleClient.trialApps.byAppId.datasets.get).mockResolvedValue({
      data: [],
      has_more: false,
      limit: 20,
      page: 1,
      total: 0,
    })

    await fetchTryAppDatasets('app-1', ['id-1', 'id-2'])

    expect(consoleClient.trialApps.byAppId.datasets.get).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
      query: { ids: ['id-1', 'id-2'] },
    })
  })

  it('normalizes generated parameters into the existing chat config shape', async () => {
    vi.mocked(consoleClient.trialApps.byAppId.parameters.get).mockResolvedValue(baseTryAppParameters())

    const params = await fetchTryAppParams('app-1')

    expect(consoleClient.trialApps.byAppId.parameters.get).toHaveBeenCalledWith({
      params: { app_id: 'app-1' },
    })
    expect(params).toMatchObject({
      opening_statement: 'Hello',
      suggested_questions: ['Question 1'],
      text_to_speech: {
        enabled: true,
        voice: 'alloy',
        language: 'en-US',
        autoPlay: TtsAutoPlay.enabled,
      },
      annotation_reply: {
        id: 'annotation-1',
        enabled: true,
        score_threshold: 0.65,
        embedding_model: {
          embedding_provider_name: 'openai',
          embedding_model_name: 'text-embedding-3-large',
        },
      },
      file_upload: {
        image: {
          enabled: true,
          number_limits: 5,
          detail: Resolution.low,
          transfer_methods: [TransferMethod.remote_url],
        },
        allowed_upload_methods: [TransferMethod.local_file],
        allowed_file_upload_methods: [TransferMethod.remote_url],
        allowed_file_types: ['image'],
        allowed_file_extensions: ['.png'],
        max_length: 2,
        number_limits: 3,
      },
      user_input_form: [
        {
          'text-input': {
            default: '',
            hide: false,
            label: 'Name',
            max_length: 48,
            required: true,
            variable: 'name',
          },
        },
        {
          select: {
            default: '',
            hide: false,
            label: 'Priority',
            options: ['low', 'high'],
            required: false,
            variable: 'priority',
          },
        },
        {
          external_data_tool: {
            config: {
              endpoint: '/lookup',
            },
            enabled: true,
            hide: false,
            icon: 'search',
            icon_background: '#fff',
            label: 'Lookup',
            required: true,
            type: 'api',
            variable: 'lookup',
          },
        },
        {
          json_object: {
            default: '',
            hide: false,
            json_schema: {
              type: 'object',
            },
            label: 'Payload',
            required: true,
            variable: 'payload',
          },
        },
      ],
    })
  })

  it('uses chat config defaults when generated parameter json contains invalid optional values', async () => {
    vi.mocked(consoleClient.trialApps.byAppId.parameters.get).mockResolvedValue(baseTryAppParameters({
      annotation_reply: {
        id: 1,
        enabled: 'yes',
        score_threshold: 'invalid',
        embedding_model: null,
      },
      file_upload: {
        image: {
          detail: 'medium',
          transfer_methods: ['invalid'],
        },
        allowed_upload_methods: 'all',
        allowed_file_upload_methods: [],
        allowed_file_types: ['image', 1],
        allowed_file_extensions: ['.png', 1],
        max_length: '2',
        number_limits: null,
      },
      opening_statement: null,
      text_to_speech: {
        enabled: true,
        autoPlay: 'invalid',
      },
      user_input_form: [
        {
          paragraph: {
            label: 'Bio',
            variable: 'bio',
          },
        },
        {
          unsupported: {
            label: 'ignored',
          },
        },
      ],
    }))

    const params = await fetchTryAppParams('app-1')

    expect(params.opening_statement).toBe('')
    expect(params.text_to_speech).toEqual({
      enabled: true,
      voice: undefined,
      language: undefined,
    })
    expect(params.annotation_reply).toEqual({
      id: '',
      enabled: false,
      score_threshold: 0.9,
      embedding_model: {
        embedding_model_name: '',
        embedding_provider_name: '',
      },
    })
    expect(params.file_upload).toMatchObject({
      image: {
        enabled: false,
        number_limits: 3,
        detail: Resolution.high,
        transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      },
      allowed_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      allowed_file_types: ['image'],
      allowed_file_extensions: ['.png'],
      max_length: 1,
      number_limits: 1,
    })
    expect(params.user_input_form).toEqual([
      {
        paragraph: {
          default: '',
          hide: false,
          label: 'Bio',
          max_length: 0,
          required: true,
          variable: 'bio',
        },
      },
    ])
  })
})
