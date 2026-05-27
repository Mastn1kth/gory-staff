export function resolveReachableConnection(
  targetUrl: string,
  pingServer: (apiUrl: string, timeoutMs?: number) => Promise<boolean>,
  resolveApiUrl: (preferredUrl?: string) => Promise<string>,
): Promise<{ online: boolean; apiUrl: string }>;
