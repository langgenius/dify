export class SemanticCandidateVisibilityDeniedError extends Error {
  constructor() {
    super("Semantic mutation requires visibility over the complete candidate corpus");
    this.name = "SemanticCandidateVisibilityDeniedError";
  }
}

export class SemanticCandidateClosureUnavailableError extends Error {
  constructor() {
    super("Semantic candidate closure could not be proven within configured bounds");
    this.name = "SemanticCandidateClosureUnavailableError";
  }
}
