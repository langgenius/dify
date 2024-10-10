'use server'

import { revalidatePath } from 'next/cache'

// Server Actions
export async function handleDelete() {
  // revalidatePath only invalidates the cache when the included path is next visited.
  revalidatePath('/')
}
