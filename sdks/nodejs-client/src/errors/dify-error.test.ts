import { describe, expect, it } from "vitest";
import {
  APIError,
  AuthenticationError,
  DifyError,
  FileUploadError,
  NetworkError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from "./dify-error";

describe("Dify errors", () => {
  it("sets base error fields", () => {
    const err = new DifyError("base", {
      statusCode: 400,
      responseBody: { message: "bad" },
      requestId: "req",
      retryAfter: 1,
    });
    expect(err.name).toBe("DifyError");
    expect(err.statusCode).toBe(400);
    expect(err.responseBody).toEqual({ message: "bad" });
    expect(err.requestId).toBe("req");
    expect(err.retryAfter).toBe(1);
  });

  it("creates specific error types", () => {
    expect(new APIError("api").name).toBe("APIError");
    expect(new AuthenticationError("auth").name).toBe("AuthenticationError");
    expect(new RateLimitError("rate").name).toBe("RateLimitError");
    expect(new ValidationError("val").name).toBe("ValidationError");
    expect(new NetworkError("net").name).toBe("NetworkError");
    expect(new TimeoutError("timeout").name).toBe("TimeoutError");
    expect(new FileUploadError("upload").name).toBe("FileUploadError");
  });
});
