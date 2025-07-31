export type MemoryItem = {
  name: string;
  content: string;
  status?: 'latest' | 'needUpdate';
  mergeCount?: number;
}
