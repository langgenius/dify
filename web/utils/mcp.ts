/**
 * MCP (Model Context Protocol) utility functions
 */

/**
 * Determines if the MCP icon should be used based on the icon source
 * @param src - The icon source, can be a string URL or an object with content and background
 * @returns true if the MCP icon should be used (when it's an emoji object with 🔗 content)
 */
export const shouldUseMcpIcon = (src: any): boolean => {
  return typeof src === 'object' && src?.content === '🔗'
}

/**
 * Checks if an app icon should use the MCP icon
 * @param iconType - The type of icon ('emoji' | 'image')
 * @param icon - The icon content (emoji or file ID)
 * @returns true if the MCP icon should be used
 */
export const shouldUseMcpIconForAppIcon = (iconType: string, icon: string): boolean => {
  return iconType === 'emoji' && icon === '🔗'
}
