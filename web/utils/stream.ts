// https://developer.chrome.com/articles/fetch-streaming-requests/#feature-detection
export const isSupportNativeFetchStream = () => {
  const supportsRequestStreams = (() => {
    let duplexAccessed = false

    const params = {
      body: new ReadableStream(),
      method: 'POST',
      get duplex() {
        duplexAccessed = true
        return 'half'
      },
    }

    const hasContentType = new Request('', params).headers.has('Content-Type')

    return duplexAccessed && !hasContentType
  })()

  return supportsRequestStreams
}
