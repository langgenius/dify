import { uploadKnowledgeDocument } from '../service'

const postMock = vi.hoisted(() => vi.fn())

vi.mock('@/service/base', () => ({
  post: postMock,
}))

describe('new RAG service', () => {
  beforeEach(() => {
    postMock.mockResolvedValue({ id: 'document-1' })
  })

  it('uploads a document as multipart form data', async () => {
    const file = new File(['handbook'], 'handbook.pdf', { type: 'application/pdf' })

    await uploadKnowledgeDocument({
      file,
      knowledgeSpaceId: 'space-1',
    })

    expect(postMock).toHaveBeenCalledWith(
      '/knowledge-fs/knowledge-spaces/space-1/documents',
      { body: expect.any(FormData) },
      { bodyStringify: false, deleteContentType: true },
    )
    const formData = postMock.mock.calls[0]?.[1].body as FormData
    expect(formData.get('file')).toBe(file)
  })
})
