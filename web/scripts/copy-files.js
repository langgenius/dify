const path = require('node:path')
const fs = require('fs-extra')

const copyFiles = async () => {
  try {
    await fs.copy(
      path.join('.next', 'static'),
      path.join('.next', 'standalone', '.next', 'static'),
    )
    await fs.copy('public', path.join('.next', 'standalone', 'public'))
    console.log('Files copied successfully')
  }
  catch (err) {
    console.error('Error copying files:', err)
    process.exit(1)
  }
}

copyFiles()
