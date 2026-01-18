import type { StateStorage } from 'zustand/middleware'
import { storage } from '@/utils/storage'

export const createZustandStorage = (): StateStorage => ({
  getItem: (name: string) => storage.get<string>(name),
  setItem: storage.set,
  removeItem: storage.remove,
})
