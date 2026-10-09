/** Host of a URL without "www.", or the text itself when it is not a URL. */
export function hostLabel(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** true only for http and https links. Evidence links come from providers, so anything else is not rendered as a link. */
export function isSafeLink(url: string | null): url is string {
  return Boolean(url && /^https?:\/\//i.test(url));
}
