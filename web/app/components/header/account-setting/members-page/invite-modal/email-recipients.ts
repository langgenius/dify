export type EmailRecipient = {
  value: string
  isValid: boolean
}

const EMAIL_DELIMITER_PATTERN = /[,;\s]+/

function isEmailValid(value: string) {
  const input = document.createElement('input')
  input.type = 'email'
  input.value = value
  return input.validity.valid
}

export function hasEmailDelimiter(value: string) {
  return EMAIL_DELIMITER_PATTERN.test(value)
}

export function mergeEmailRecipients(recipients: EmailRecipient[], input: string) {
  const nextRecipients = [...recipients]
  const existingValues = new Set(recipients.map(({ value }) => value))

  input
    .split(EMAIL_DELIMITER_PATTERN)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .forEach((value) => {
      if (existingValues.has(value)) return

      existingValues.add(value)
      nextRecipients.push({ value, isValid: isEmailValid(value) })
    })

  return nextRecipients
}
