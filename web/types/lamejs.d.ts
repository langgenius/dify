declare module 'lamejs' {
  export class Mp3Encoder {
    constructor(channels: number, sampleRate: number, bitRate: number)
    encodeBuffer(left: Int16Array, right?: Int16Array | null): Int8Array
    flush(): Int8Array
  }

  export class WavHeader {
    static readHeader(data: DataView): {
      channels: number
      sampleRate: number
    }
  }

  const lamejs: {
    Mp3Encoder: typeof Mp3Encoder
    WavHeader: typeof WavHeader
  }

  export default lamejs
}

declare module 'lamejs/src/js/MPEGMode' {
  const MPEGMode: any
  export default MPEGMode
}

declare module 'lamejs/src/js/Lame' {
  const Lame: any
  export default Lame
}

declare module 'lamejs/src/js/BitStream' {
  const BitStream: any
  export default BitStream
}
