const DEFAULT_BASE_URL = "https://mcppedia.org";

function getConfig(): { baseUrl: string } {
  const baseUrl = (process.env.MCPPEDIA_API_URL || DEFAULT_BASE_URL).replace(
    /\/$/,
    ""
  );
  return { baseUrl };
}

export async function mcpApiCall(
  action: string,
  params: Record<string, unknown>
): Promise<{ data?: unknown; error?: string }> {
  const { baseUrl } = getConfig();
  const url = `${baseUrl}/api/mcp`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, params }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { error: `MCPpedia API unreachable: ${msg}` };
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After") || "60";
    return { error: `Rate limited. Try again in ${retryAfter} seconds.` };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return {
      error:
        (body as Record<string, string>).error || `API error: ${res.status}`,
    };
  }

  const body = await res.json().catch(() => ({}));
  return { data: (body as Record<string, unknown>).data };
}
