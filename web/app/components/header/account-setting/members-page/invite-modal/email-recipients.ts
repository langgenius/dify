export type EmailRecipient = {
  value: string
  isValid: boolean
}

const EMAIL_DELIMITER_PATTERN = /[,;\r\n\t]+/

function isEmailValid(value: string) {
  const input = document.createElement('input')
  input.type = 'email'
  input.value = value
  return input.validity.valid
}

export function createEmailRecipient(input: string): EmailRecipient {
  const value = input.trim().toLowerCase()
  return { value, isValid: Boolean(value) && isEmailValid(value) }
}

export function hasEmailDelimiter(value: string) {
  return EMAIL_DELIMITER_PATTERN.test(value)
}

export function mergeEmailRecipients(recipients: EmailRecipient[], input: string) {
  const nextRecipients = [...recipients]
  const existingValues = new Set(recipients.map(({ value }) => value))

  input
    .split(EMAIL_DELIMITER_PATTERN)
    .map(createEmailRecipient)
    .filter(({ value }) => Boolean(value))
    .forEach((recipient) => {
      const { value } = recipient
      if (existingValues.has(value)) return

      existingValues.add(value)
      nextRecipients.push(recipient)
    })

  return nextRecipients
}
