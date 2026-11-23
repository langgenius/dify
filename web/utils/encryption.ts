function encryptField(plaintext: string): string {
  try {
    const utf8Bytes = new TextEncoder().encode(plaintext)
    const base64 = btoa(String.fromCharCode(...utf8Bytes))
    return base64
  } catch (error) {
    console.error('Field encoding failed:', error)
    throw new Error('Encoding failed. Please check your input.')
  }
}

export function encryptPassword(password: string): string {
  return encryptField(password)
}

export function encryptVerificationCode(code: string): string {
  return encryptField(code)
}
