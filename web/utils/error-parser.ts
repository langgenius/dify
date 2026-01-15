/**
 * Parse plugin error message from nested error structure
 * Extracts the real error message from PluginInvokeError JSON string
 *
 * @example
 * Input: { message: "req_id: xxx PluginInvokeError: {\"message\":\"Bad credentials\"}" }
 * Output: "Bad credentials"
 *
 * @param error - Error object (can be Response object or error with message property)
 * @returns Promise<string> or string - Parsed error message
 */
export const parsePluginErrorMessage = async (error: any): Promise<string> => {
  let rawMessage = ''

  // Handle Response object from fetch/ky
  if (error instanceof Response) {
    try {
      const body = await error.clone().json()
      rawMessage = body?.message || error.statusText || 'Unknown error'
    }
    catch {
      rawMessage = error.statusText || 'Unknown error'
    }
  }
  else {
    rawMessage = error?.message || error?.toString() || 'Unknown error'
  }

  console.log('rawMessage', rawMessage)

  // Try to extract nested JSON from PluginInvokeError
  // Use greedy match .+ to capture the complete JSON object with nested braces
  const pluginErrorPattern = /PluginInvokeError:\s*(\{.+\})/
  const match = rawMessage.match(pluginErrorPattern)

  if (match) {
    try {
      const errorData = JSON.parse(match[1])
      // Return the inner message if exists
      if (errorData.message)
        return errorData.message
      // Fallback to error_type if message not available
      if (errorData.error_type)
        return errorData.error_type
    }
    catch (parseError) {
      console.warn('Failed to parse plugin error JSON:', parseError)
    }
  }

  return rawMessage
}
