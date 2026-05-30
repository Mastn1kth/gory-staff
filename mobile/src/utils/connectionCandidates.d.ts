export type ApiPriorityInput = {
  configuredUrl?: string | null;
  defaultUrl?: string | null;
  preferredUrl?: string | null;
  savedUrl?: string | null;
  fallbackUrls?: string[];
  emulatorUrl?: string | null;
  localProbeUrls?: string[];
};

export function isPrivateNetworkApiUrl(apiUrl?: string | null): boolean;
export function orderApiPriorityUrls(input: ApiPriorityInput): string[];
