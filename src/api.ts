const DEFAULT_BASE_URL = "https://mcppedia.org";

let baseUrl: string | null = null;
let apiKey: string | undefined;

function getBaseUrl(): string {
  if (!baseUrl) {
    baseUrl = (process.env.MCPPEDIA_API_URL || DEFAULT_BASE_URL).replace(
      /\/$/,
      ""
    );
    apiKey = process.env.MCPPEDIA_API_KEY;
  }
  return baseUrl;
}

export async function mcpApiCall(
  action: string,
  params: Record<string, unknown>
): Promise<{ data?: unknown; error?: string }> {
  const url = `${getBaseUrl()}/api/mcp`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, params }),
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After") || "60";
    return {
      error: `Rate limited. Try again in ${retryAfter} seconds. Get higher limits at https://mcppedia.org/pro`,
    };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: (body as Record<string, string>).error || `API error: ${res.status}` };
  }

  const body = await res.json();
  return { data: (body as Record<string, unknown>).data };
}
