import type { FC } from 'react'
import type { ChatItem } from '../../types'
import { memo, useMemo } from 'react'
import InfographicViewer from '@/app/components/infographic'

type InfographicContentProps = {
  item: ChatItem
}

/**
 * Detects if the content contains infographic syntax
 * @antv/infographic uses a YAML-like syntax, not JSON
 * Example:
 * infographic list-row-simple-horizontal-arrow
 * data
 *   lists
 *     - label Step 1
 *       desc Start
 */
function parseInfographicSyntax(content: string): string | null {
  try {
    // Check if content starts with "infographic" keyword
    if (content.trim().startsWith('infographic ')) {
      return content.trim()
    }
    
    // Try to extract from markdown code blocks
    // Look for ```infographic or ```yaml blocks
    const codeBlockRegex = /```(?:infographic|yaml)?\s*\n([\s\S]*?)\n```/
    const match = content.match(codeBlockRegex)
    
    if (match && match[1]) {
      const blockContent = match[1].trim()
      if (blockContent.startsWith('infographic ')) {
        return blockContent
      }
    }
    
    // Check for indented infographic syntax (common in AI responses)
    const lines = content.split('\n')
    let infographicStart = -1
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('infographic ')) {
        infographicStart = i
        break
      }
    }
    
    if (infographicStart >= 0) {
      // Extract from the infographic line to the end or until we hit non-indented content
      const infographicLines = [lines[infographicStart]]
      
      for (let i = infographicStart + 1; i < lines.length; i++) {
        const line = lines[i]
        // Stop if we hit an empty line followed by non-indented content
        if (line.trim() === '' && i + 1 < lines.length && !lines[i + 1].startsWith(' ')) {
          break
        }
        infographicLines.push(line)
      }
      
      return infographicLines.join('\n').trim()
    }
    
    return null
  }
  catch {
    return null
  }
}

const InfographicContent: FC<InfographicContentProps> = ({ item }) => {
  const { content } = item

  const infographicSyntax = useMemo(() => {
    if (typeof content !== 'string')
      return null
    
    return parseInfographicSyntax(content)
  }, [content])

  if (!infographicSyntax)
    return null

  return (
    <div className="my-3">
      <InfographicViewer
        syntax={infographicSyntax}
        height={400}
        onError={(error) => {
          console.error('Infographic rendering error:', error)
        }}
      />
    </div>
  )
}

export default memo(InfographicContent)
