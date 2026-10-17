import { AnnotationEnableStatus } from '@/app/components/app/annotation/type'
import { updateAnnotationStatus } from './annotation'
import { consoleClient } from './console'

vi.mock('./console', () => ({
  consoleClient: {
    apps: { byAppId: { annotationReply: { byAction: { post: vi.fn() } } } },
  },
}))

describe('annotation service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should preserve zero score threshold when updating annotation status', () => {
    updateAnnotationStatus(
      'app-1',
      AnnotationEnableStatus.enable,
      {
        embedding_model_name: 'model',
        embedding_provider_name: 'provider',
      },
      0,
    )

    expect(consoleClient.apps.byAppId.annotationReply.byAction.post).toHaveBeenCalledWith({
      params: { app_id: 'app-1', action: 'enable' },
      body: {
        embedding_model_name: 'model',
        embedding_provider_name: 'provider',
        score_threshold: 0,
      },
    })
  })
})
