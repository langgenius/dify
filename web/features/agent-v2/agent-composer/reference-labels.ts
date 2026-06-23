import type { AgentKnowledgeRetrievalItem, AgentTool } from './form-state'

const getKnowledgeRetrievalName = (item: AgentKnowledgeRetrievalItem) => item.name ?? item.nameKey ?? item.id

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const createReferenceToken = (kind: string, id: string, label: string) => (
  `[§${kind}:${id}${label ? `:${label}` : ''}§]`
)

const syncReferenceLabels = ({
  prompt,
  kind,
  currentItems,
  nextItems,
}: {
  prompt: string
  kind: string
  currentItems: Array<{ id: string, name: string }>
  nextItems: Array<{ id: string, name: string }>
}) => {
  const currentItemById = new Map(currentItems.map(item => [item.id, item]))

  return nextItems.reduce((nextPrompt, nextItem) => {
    const currentItem = currentItemById.get(nextItem.id)
    if (!currentItem)
      return nextPrompt

    if (currentItem.name === nextItem.name)
      return nextPrompt

    return nextPrompt.replace(
      new RegExp(`\\[§${escapeRegExp(kind)}:${escapeRegExp(nextItem.id)}(?::[^§\\]]*)?§\\]`, 'g'),
      createReferenceToken(kind, nextItem.id, nextItem.name),
    )
  }, prompt)
}

const toReferenceLabelItems = <Item extends { id: string }>(
  items: Item[],
  getName: (item: Item) => string,
) => items.map(item => ({
  id: item.id,
  name: getName(item),
}))

export const syncKnowledgeReferenceLabels = ({
  prompt,
  currentRetrievals,
  nextRetrievals,
}: {
  prompt: string
  currentRetrievals: AgentKnowledgeRetrievalItem[]
  nextRetrievals: AgentKnowledgeRetrievalItem[]
}) => syncReferenceLabels({
  prompt,
  kind: 'knowledge',
  currentItems: toReferenceLabelItems(currentRetrievals, getKnowledgeRetrievalName),
  nextItems: toReferenceLabelItems(nextRetrievals, getKnowledgeRetrievalName),
})

export const syncCliToolReferenceLabels = ({
  prompt,
  currentTools,
  nextTools,
}: {
  prompt: string
  currentTools: AgentTool[]
  nextTools: AgentTool[]
}) => syncReferenceLabels({
  prompt,
  kind: 'cli_tool',
  currentItems: toReferenceLabelItems(currentTools.filter(tool => tool.kind === 'cli'), tool => tool.name),
  nextItems: toReferenceLabelItems(nextTools.filter(tool => tool.kind === 'cli'), tool => tool.name),
})
