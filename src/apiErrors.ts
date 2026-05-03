type ApiErrorBody = {
  error?: unknown;
  details?: unknown;
};

export async function readFailedSyncMessage(response: Response) {
  const fallback = `Failed to sync: HTTP ${response.status}`;

  let body: ApiErrorBody;
  try {
    body = await response.json() as ApiErrorBody;
  } catch {
    return fallback;
  }

  const error = typeof body.error === "string" ? body.error.trim() : "";
  if (!error) return fallback;

  const details = Array.isArray(body.details)
    ? body.details
      .filter((detail): detail is string => typeof detail === "string" && detail.trim().length > 0)
      .map((detail) => detail.trim())
      .join("; ")
    : "";

  return details ? `${error}\n${details}` : error;
}
