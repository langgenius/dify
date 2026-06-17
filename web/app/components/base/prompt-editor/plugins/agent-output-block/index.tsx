import type { TextNode } from 'lexical'
import type { AgentOutputBlockType } from '../../types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  $applyNodeReplacement,
  $getRoot,
  $insertNodes,
  COMMAND_PRIORITY_EDITOR,
} from 'lexical'
import { memo, useCallback, useEffect } from 'react'
import { decoratorTransform } from '../../utils'
import { CustomTextNode } from '../custom-text/node'
import { INSERT_AGENT_OUTPUT_BLOCK_COMMAND } from './commands'
import { $createAgentOutputBlockNode, AgentOutputBlockNode } from './node'
import {
  createAgentOutputConfig,
  getAgentOutputTypeOptionValue,
  getUniqueAgentOutputName,
  parseAgentOutputToken,
} from './utils'

const AgentOutputBlock = memo(({
  outputs = [],
  onChange,
}: AgentOutputBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([AgentOutputBlockNode]))
      throw new Error('AgentOutputBlockPlugin: AgentOutputBlock not registered on editor')

    return mergeRegister(
      editor.registerCommand(
        INSERT_AGENT_OUTPUT_BLOCK_COMMAND,
        () => {
          const name = getUniqueAgentOutputName(outputs)
          const outputType = 'string'
          const nextOutputs = [...outputs, createAgentOutputConfig(name, outputType)]
          const agentOutputBlockNode = $createAgentOutputBlockNode(name, outputType, nextOutputs, onChange)

          $insertNodes([agentOutputBlockNode])
          const nextPrompt = $getRoot().getChildren().map(node => node.getTextContent()).join('\n')
          onChange?.(nextOutputs, nextPrompt)

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    )
  }, [editor, onChange, outputs])

  return null
})
AgentOutputBlock.displayName = 'AgentOutputBlock'

const AgentOutputBlockReplacementBlock = memo(({
  outputs = [],
  onChange,
}: AgentOutputBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([AgentOutputBlockNode]))
      throw new Error('AgentOutputBlockNodePlugin: AgentOutputBlockNode not registered on editor')
  }, [editor])

  const createAgentOutputBlockNode = useCallback((textNode: TextNode): AgentOutputBlockNode => {
    const match = parseAgentOutputToken(textNode.getTextContent())
    const name = match?.name || ''
    const output = outputs.find(item => item.name === name)
    const outputType = output ? getAgentOutputTypeOptionValue(output) : 'string'

    return $applyNodeReplacement($createAgentOutputBlockNode(name, outputType, outputs, onChange))
  }, [onChange, outputs])

  const getMatch = useCallback((text: string) => {
    const match = parseAgentOutputToken(text)

    if (!match)
      return null

    return {
      end: match.end,
      start: match.start,
    }
  }, [])

  const transformListener = useCallback((textNode: CustomTextNode) => {
    return decoratorTransform(textNode, getMatch, createAgentOutputBlockNode)
  }, [createAgentOutputBlockNode, getMatch])

  useEffect(() => {
    return mergeRegister(
      editor.registerNodeTransform(CustomTextNode, transformListener),
    )
  }, [editor, transformListener])

  return null
})
AgentOutputBlockReplacementBlock.displayName = 'AgentOutputBlockReplacementBlock'

export { AgentOutputBlock, AgentOutputBlockReplacementBlock }
