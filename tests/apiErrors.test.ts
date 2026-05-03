import { describe, expect, it } from "vitest";
import { readFailedSyncMessage } from "../src/apiErrors";

function jsonResponse(body: unknown, status = 400) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("failed sync API messages", () => {
  it("uses the API error string", async () => {
    await expect(readFailedSyncMessage(jsonResponse({ error: "Unauthorized to edit this tab" }, 403)))
      .resolves.toBe("Unauthorized to edit this tab");
  });

  it("keeps validation details on a second line", async () => {
    await expect(readFailedSyncMessage(jsonResponse({
      error: "Invalid tab payload",
      details: [
        "tab.layout.tools must contain at most 100 items",
        "tab.name must not be empty",
      ],
    }))).resolves.toBe("Invalid tab payload\ntab.layout.tools must contain at most 100 items; tab.name must not be empty");
  });

  it("falls back when the response is not JSON", async () => {
    await expect(readFailedSyncMessage(new Response("nope", { status: 502 })))
      .resolves.toBe("Failed to sync: HTTP 502");
  });

  it("falls back when the response body is empty", async () => {
    await expect(readFailedSyncMessage(new Response("", { status: 500 })))
      .resolves.toBe("Failed to sync: HTTP 500");
  });
});
