/**
 * @fileoverview ScriptBlock component for handling <script> tags in Markdown.
 * Extracted from the main markdown renderer for modularity.
 * Note: Current implementation returns the script tag as a string, which might not execute as expected in React.
 * This behavior is preserved from the original implementation and may need review for security and functionality.
 */
import { memo } from 'react'

const ScriptBlock = memo(({ node }: any) => {
  const scriptContent = node.children[0]?.value || ''
  return `<script>${scriptContent}</script>`
})
ScriptBlock.displayName = 'ScriptBlock'

export default ScriptBlock
