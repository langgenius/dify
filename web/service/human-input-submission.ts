export class HumanInputSubmissionPreparationError extends Error {
  constructor() {
    super('Human Input submission could not establish the workflow connection')
    this.name = 'HumanInputSubmissionPreparationError'
  }
}

export const prepareHumanInputFormSubmission = async (prepare: () => Promise<boolean>) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const ready = await Promise.race([
      prepare(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HumanInputSubmissionPreparationError()), 15_000)
      }),
    ])
    if (!ready) throw new HumanInputSubmissionPreparationError()
  } finally {
    clearTimeout(timer)
  }
}
