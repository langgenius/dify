export async function writeTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText)
    return navigator.clipboard.writeText(text)

  return fallbackCopyTextToClipboard(text)
}

async function fallbackCopyTextToClipboard(text: string): Promise<void> {
  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.style.position = 'fixed' // Avoid scrolling to bottom
  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()
  try {
    const successful = document.execCommand('copy')
    if (successful)
      return Promise.resolve()

    return Promise.reject(new Error('document.execCommand failed'))
  }
  catch (err) {
    return Promise.reject(convertAnyToError(err))
  }
  finally {
    document.body.removeChild(textArea)
  }
}

function convertAnyToError(err: any): Error {
  if (err instanceof Error)
    return err

  return new Error(`Caught: ${String(err)}`)
}
