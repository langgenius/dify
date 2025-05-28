export const createImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', error => reject(error))
    image.setAttribute('crossOrigin', 'anonymous') // needed to avoid cross-origin issues on CodeSandbox
    image.src = url
  })

export function getRadianAngle(degreeValue: number) {
  return (degreeValue * Math.PI) / 180
}

export function getMimeType(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    default:
      return 'image/jpeg'
  }
}

/**
 * Returns the new bounding area of a rotated rectangle.
 */
export function rotateSize(width: number, height: number, rotation: number) {
  const rotRad = getRadianAngle(rotation)

  return {
    width:
            Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height:
            Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
  }
}

/**
 * This function was adapted from the one in the ReadMe of https://github.com/DominicTobias/react-image-crop
 */
export default async function getCroppedImg(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number },
  fileName: string,
  rotation = 0,
  flip = { horizontal: false, vertical: false },
): Promise<Blob> {
  const image = await createImage(imageSrc)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const mimeType = getMimeType(fileName)

  if (!ctx)
    throw new Error('Could not create a canvas context')

  const rotRad = getRadianAngle(rotation)

  // calculate bounding box of the rotated image
  const { width: bBoxWidth, height: bBoxHeight } = rotateSize(
    image.width,
    image.height,
    rotation,
  )

  // set canvas size to match the bounding box
  canvas.width = bBoxWidth
  canvas.height = bBoxHeight

  // translate canvas context to a central location to allow rotating and flipping around the center
  ctx.translate(bBoxWidth / 2, bBoxHeight / 2)
  ctx.rotate(rotRad)
  ctx.scale(flip.horizontal ? -1 : 1, flip.vertical ? -1 : 1)
  ctx.translate(-image.width / 2, -image.height / 2)

  // draw rotated image
  ctx.drawImage(image, 0, 0)

  const croppedCanvas = document.createElement('canvas')

  const croppedCtx = croppedCanvas.getContext('2d')

  if (!croppedCtx)
    throw new Error('Could not create a canvas context')

  // Set the size of the cropped canvas
  croppedCanvas.width = pixelCrop.width
  croppedCanvas.height = pixelCrop.height

  // Draw the cropped image onto the new canvas
  croppedCtx.drawImage(
    canvas,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
  )

  return new Promise((resolve, reject) => {
    croppedCanvas.toBlob((file) => {
      if (file)
        resolve(file)
      else
        reject(new Error('Could not create a blob'))
    }, mimeType)
  })
}

export function checkIsAnimatedImage(file: File): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader()

    fileReader.onload = function (e) {
      const arr = new Uint8Array(e.target?.result as ArrayBuffer)

      // Check file extension
      const fileName = file.name.toLowerCase()
      if (fileName.endsWith('.gif')) {
        // If file is a GIF, assume it's animated
        resolve(true)
      }
      // Check for WebP signature (RIFF and WEBP)
      else if (isWebP(arr)) {
        resolve(checkWebPAnimation(arr)) // Check if it's animated
      }
      else {
        resolve(false) // Not a GIF or WebP
      }
    }

    fileReader.onerror = function (err) {
      reject(err) // Reject the promise on error
    }

    // Read the file as an array buffer
    fileReader.readAsArrayBuffer(file)
  })
}

// Function to check for WebP signature
function isWebP(arr: Uint8Array) {
  return (
    arr[0] === 0x52 && arr[1] === 0x49 && arr[2] === 0x46 && arr[3] === 0x46
    && arr[8] === 0x57 && arr[9] === 0x45 && arr[10] === 0x42 && arr[11] === 0x50
  ) // "WEBP"
}

// Function to check if the WebP is animated (contains ANIM chunk)
function checkWebPAnimation(arr: Uint8Array) {
  // Search for the ANIM chunk in WebP to determine if it's animated
  for (let i = 12; i < arr.length - 4; i++) {
    if (arr[i] === 0x41 && arr[i + 1] === 0x4E && arr[i + 2] === 0x49 && arr[i + 3] === 0x4D)
      return true // Found animation
  }
  return false // No animation chunk found
}
