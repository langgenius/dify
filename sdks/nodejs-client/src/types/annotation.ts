export type AnnotationCreateRequest = {
  question: string;
  answer: string;
};

export type AnnotationReplyActionRequest = {
  score_threshold: number;
  embedding_provider_name: string;
  embedding_model_name: string;
};

export type AnnotationListOptions = {
  page?: number;
  limit?: number;
  keyword?: string;
};

export type AnnotationResponse = Record<string, unknown>;
