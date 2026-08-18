/**
 * Extract the human-readable message from a PluginInvokeError envelope string.
 *
 * The plugin daemon wraps every exception into a JSON envelope, which the backend
 * then stringifies into error responses:
 *   "req_id: xxx PluginInvokeError: {\"args\":{},\"error_type\":\"ToolProviderCredentialValidationError\",\"message\":\"Invalid token\"}"
 * Toasts should show the inner `message`, not the raw envelope.
 *
 * Returns the input unchanged when it is not a plugin envelope.
 */
export const parsePluginErrorString = (rawMessage: string): string => {
  // Use greedy match .+ to capture the complete JSON object with nested braces
  const pluginErrorPattern = /PluginInvokeError:\s*(\{.+\})/
  const match = pluginErrorPattern.exec(rawMessage)

  if (match) {
    try {
      const errorData = JSON.parse(match[1]!)
      // Return the inner message if exists
      if (errorData.message) return errorData.message
      // Fallback to error_type if message not available
      if (errorData.error_type) return errorData.error_type
    } catch (parseError) {
      console.warn('Failed to parse plugin error JSON:', parseError)
    }
  }

  return rawMessage
}

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
    } catch {
      rawMessage = error.statusText || 'Unknown error'
    }
  } else {
    rawMessage = error?.message || error?.toString() || 'Unknown error'
  }

  return parsePluginErrorString(rawMessage)
}
