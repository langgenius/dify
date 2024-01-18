import type { ThoughtItem } from '../../app/chat/type'

export const sortAgentSorts = (list: ThoughtItem[]) => {
  if (!list)
    return list
  if (list.some(item => item.position === undefined))
    return list
  const temp = [...list]
  temp.sort((a, b) => a.position - b.position)
  return temp
}
