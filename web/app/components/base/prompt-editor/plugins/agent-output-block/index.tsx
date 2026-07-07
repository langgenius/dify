import type { ElementNode, TextNode } from 'lexical'
import type { AgentOutputBlockType } from '../../types'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import {
  $applyNodeReplacement,
  $getRoot,
  $insertNodes,
  $isElementNode,
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

function getAgentOutputBlockNodeType(name: string, outputs: NonNullable<AgentOutputBlockType['outputs']>) {
  const output = outputs.find(item => item.name === name)

  return output ? getAgentOutputTypeOptionValue(output) : 'string'
}

const AgentOutputBlock = memo(({
  outputs = [],
  onChange,
  onEdit,
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
          const agentOutputBlockNode = $createAgentOutputBlockNode(name, outputType, true, nextOutputs, onChange, onEdit)

          $insertNodes([agentOutputBlockNode])
          const nextPrompt = $getRoot().getChildren().map(node => node.getTextContent()).join('\n')
          onChange?.(nextOutputs, nextPrompt)

          return true
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    )
  }, [editor, onChange, onEdit, outputs])

  return null
})
AgentOutputBlock.displayName = 'AgentOutputBlock'

const AgentOutputBlockReplacementBlock = memo(({
  outputs = [],
  onChange,
  onEdit,
}: AgentOutputBlockType) => {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!editor.hasNodes([AgentOutputBlockNode]))
      throw new Error('AgentOutputBlockNodePlugin: AgentOutputBlockNode not registered on editor')
  }, [editor])

  const createAgentOutputBlockNode = useCallback((textNode: TextNode): AgentOutputBlockNode => {
    const match = parseAgentOutputToken(textNode.getTextContent())
    const name = match?.name || ''
    const outputType = getAgentOutputBlockNodeType(name, outputs)

    return $applyNodeReplacement($createAgentOutputBlockNode(name, outputType, false, outputs, onChange, onEdit))
  }, [onChange, onEdit, outputs])

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
    return decoratorTransform(textNode, getMatch, createAgentOutputBlockNode, {
      allowAdjacentMatches: true,
    })
  }, [createAgentOutputBlockNode, getMatch])

  useEffect(() => {
    return mergeRegister(
      editor.registerNodeTransform(CustomTextNode, transformListener),
    )
  }, [editor, transformListener])

  useEffect(() => {
    editor.update(() => {
      const visitNode = (node: ElementNode) => {
        node.getChildren().forEach((child) => {
          if (child instanceof AgentOutputBlockNode) {
            const name = child.getName()
            const outputType = getAgentOutputBlockNodeType(name, outputs)
            if (
              child.getOutputType() !== outputType
              || child.getOutputs() !== outputs
              || child.getOnChange() !== onChange
              || child.getOnEdit() !== onEdit
            ) {
              child.replace($createAgentOutputBlockNode(
                name,
                outputType,
                child.isEditing(),
                outputs,
                onChange,
                onEdit,
                child.shouldSelectNameOnEdit(),
                child.shouldOpenTypeSelectOnEdit(),
              ))
            }
            return
          }

          if ($isElementNode(child))
            visitNode(child)
        })
      }

      visitNode($getRoot())
    })
  }, [editor, onChange, onEdit, outputs])

  return null
})
AgentOutputBlockReplacementBlock.displayName = 'AgentOutputBlockReplacementBlock'

export { AgentOutputBlock, AgentOutputBlockReplacementBlock }
