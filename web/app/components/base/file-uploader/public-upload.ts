/**
 * Uploads a file through the public WebApp contract. The WebApp client carries the whole
 * public contract, so console bundles that share the uploaders load it only on upload.
 */
export const uploadPublicFile = async (
  file: File,
  onUploadProgress: (progress: { loaded: number; total: number }) => void,
) => {
  const { webAppClient } = await import('@/service/webapp-client')
  return webAppClient.files.upload.post({ body: { file } }, { context: { onUploadProgress } })
}
