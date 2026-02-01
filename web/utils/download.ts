export type DownloadUrlOptions = {
  url: string
  fileName?: string
  rel?: string
  target?: string
}

const triggerDownload = ({ url, fileName, rel, target }: DownloadUrlOptions) => {
  if (!url)
    return

  const anchor = document.createElement('a')
  anchor.href = url
  if (fileName)
    anchor.download = fileName
  if (rel)
    anchor.rel = rel
  if (target)
    anchor.target = target
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export const downloadUrl = ({ url, fileName, rel = 'noopener noreferrer', target }: DownloadUrlOptions) => {
  triggerDownload({ url, fileName, rel, target })
}

export const downloadBlob = ({ data, fileName }: { data: Blob, fileName: string }) => {
  const url = window.URL.createObjectURL(data)
  triggerDownload({ url, fileName, rel: 'noopener noreferrer' })
  window.URL.revokeObjectURL(url)
}
