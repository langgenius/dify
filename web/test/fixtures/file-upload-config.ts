import type { UploadConfig } from '@dify/contracts/api/console/files/types.gen'

export const createFileUploadConfigFixture = (
  overrides: Partial<UploadConfig> = {},
): UploadConfig => ({
  attachment_image_file_size_limit: 2,
  audio_file_size_limit: 50,
  batch_count_limit: 5,
  file_size_limit: 15,
  file_upload_limit: 5,
  image_file_batch_limit: 10,
  image_file_size_limit: 10,
  knowledge_file_size_limit: 15,
  single_chunk_attachment_limit: 10,
  skill_file_size_limit: 50,
  video_file_size_limit: 100,
  workflow_file_upload_limit: 10,
  ...overrides,
})
