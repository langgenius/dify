export const parsePluginErrorMessage = (error: any): string => {
  const rawMessage = error?.message || error?.toString() || 'Unknown error'

  const pluginErrorPattern = /PluginInvokeError:\s*(\{.+\})/
  const match = pluginErrorPattern.exec(rawMessage)

  if (match) {
    try {
      const errorData = JSON.parse(match[1]!)
      if (errorData.message) return errorData.message
      if (errorData.error_type) return errorData.error_type
    } catch (parseError) {
      console.warn('Failed to parse plugin error JSON:', parseError)
    }
  }

  return rawMessage
}
