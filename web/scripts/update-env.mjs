import * as fs from 'node:fs'

function parseEnvFile(contents) {
  return contents.split('\n').reduce((acc, line) => {
    const [key, value] = line.split('=')
    if (key)
      acc.set(key.trim(), value === undefined ? '' : value.trim())

    return acc
  }, new Map())
}

function updateEnvironmentFile() {
  const examplePath = '.env.example'
  const envPath = '.env'

  const exampleContents = fs.readFileSync(examplePath, 'utf-8')
  const envContents = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : ''

  const exampleConfig = parseEnvFile(exampleContents)
  const envConfig = parseEnvFile(envContents)

  exampleConfig.forEach((value, key) => {
    if (!envConfig.has(key))
      envConfig.set(key, value)
  })

  // 生成新的 .env 内容
  const newEnvContents = Array.from(envConfig.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  fs.writeFileSync(envPath, newEnvContents)
  console.log('.env file has been updated')
}

updateEnvironmentFile()
