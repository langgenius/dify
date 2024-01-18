import type { ThoughtItem } from '../../app/chat/type'

export const sortAgentSorts = (list: ThoughtItem[]) => {
  const temp = [...list]
  temp.sort((a, b) => a.position - b.position)
  return temp
}
