/**
 * @fileoverview Utility functions for preprocessing Markdown content.
 * These functions were extracted from the main markdown renderer for better separation of concerns.
 * Includes preprocessing for LaTeX and custom "think" tags.
 */
import { flow } from 'lodash-es'

export const preprocessLaTeX = (content: string) => {
  if (typeof content !== 'string')
    return content

  const codeBlockRegex = /```[\s\S]*?```/g
  const codeBlocks = content.match(codeBlockRegex) || []
  let processedContent = content.replace(codeBlockRegex, 'CODE_BLOCK_PLACEHOLDER')

  processedContent = flow([
    (str: string) => str.replace(/\\\[(.*?)\\\]/g, (_, equation) => `$$${equation}$$`),
    (str: string) => str.replace(/\\\[([\s\S]*?)\\\]/g, (_, equation) => `$$${equation}$$`),
    (str: string) => str.replace(/\\\((.*?)\\\)/g, (_, equation) => `$$${equation}$$`),
    (str: string) => str.replace(/(^|[^\\])\$(.+?)\$/g, (_, prefix, equation) => `${prefix}$${equation}$`),
  ])(processedContent)

  codeBlocks.forEach((block) => {
    processedContent = processedContent.replace('CODE_BLOCK_PLACEHOLDER', block)
  })

  return processedContent
}

export const preprocessThinkTag = (content: string) => {
  const thinkOpenTagRegex = /<think>\n/g
  const thinkCloseTagRegex = /\n<\/think>/g
  return flow([
    (str: string) => str.replace(thinkOpenTagRegex, '<details data-think=true>\n'),
    (str: string) => str.replace(thinkCloseTagRegex, '\n[ENDTHINKFLAG]</details>'),
  ])(content)
}
