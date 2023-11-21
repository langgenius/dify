declare module 'lamejs';
declare module 'react-18-input-autosize';
declare module 'fetch-readablestream' {
  export default function fetchReadableStream(url: string, options?: RequestInit): Promise<Response>
}
