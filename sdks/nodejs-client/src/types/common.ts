export const DEFAULT_BASE_URL = "https://api.dify.ai/v1";
export const DEFAULT_TIMEOUT_SECONDS = 60;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_RETRY_DELAY_SECONDS = 1;

export type RequestMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type QueryParamValue =
  | string
  | number
  | boolean
  | Array<string | number | boolean>
  | undefined;

export type QueryParams = Record<string, QueryParamValue>;

export type Headers = Record<string, string>;

export type DifyClientConfig = {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  enableLogging?: boolean;
};

export type DifyResponse<T> = {
  data: T;
  status: number;
  headers: Headers;
  requestId?: string;
};

export type MessageFeedbackRequest = {
  messageId: string;
  user: string;
  rating?: "like" | "dislike" | null;
  content?: string | null;
};

export type TextToAudioRequest = {
  user: string;
  text?: string;
  message_id?: string;
  streaming?: boolean;
  voice?: string;
};

export type StreamEvent<T = unknown> = {
  event?: string;
  data: T | string | null;
  raw: string;
};

export type DifyStream<T = unknown> = AsyncIterable<StreamEvent<T>> & {
  data: NodeJS.ReadableStream;
  status: number;
  headers: Headers;
  requestId?: string;
  toText(): Promise<string>;
  toReadable(): NodeJS.ReadableStream;
};

export type BinaryStream = {
  data: NodeJS.ReadableStream;
  status: number;
  headers: Headers;
  requestId?: string;
  toReadable(): NodeJS.ReadableStream;
};
