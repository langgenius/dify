export type History = {
  id: string
  source: string
  target: string
}
export type HistoryResponse = {
  histories: History[]
}

export const fetchHistories = (url: string) =>
  fetch(url).then<HistoryResponse>(r => r.json())
