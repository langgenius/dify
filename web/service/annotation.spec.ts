import { AnnotationEnableStatus } from '@/app/components/app/annotation/type'
import { updateAnnotationStatus } from './annotation'
import { post } from './base'

vi.mock('./base', () => ({
  post: vi.fn(),
}))

describe('annotation service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should preserve zero score threshold when updating annotation status', () => {
    updateAnnotationStatus('app-1', AnnotationEnableStatus.enable, {
      embedding_model_name: 'model',
      embedding_provider_name: 'provider',
    }, 0)

    expect(post).toHaveBeenCalledWith('apps/app-1/annotation-reply/enable', {
      body: {
        embedding_model_name: 'model',
        embedding_provider_name: 'provider',
        score_threshold: 0,
      },
    })
  })
})
