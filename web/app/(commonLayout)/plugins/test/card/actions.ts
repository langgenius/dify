'use server'

import { revalidatePath } from 'next/cache'

// Server Actions
export async function handleDelete() {
  // revalidatePath only invalidates the cache when the included path is next visited.
  revalidatePath('/')
}

export async function fetchPluginDetail(org: string, name: string) {
  // Fetch plugin detail TODO
  return { org, name }
}
