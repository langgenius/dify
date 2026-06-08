export const getDSLImportErrorMessage = async (error: unknown, fallback: string): Promise<string> => {
  if (error instanceof Response) {
    try {
      const data = await error.clone().json() as { error?: string, message?: string }
      const message = data?.error || data?.message
      if (message)
        return message
    }
    catch {}
  }
  return fallback
}
