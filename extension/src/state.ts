export const MAX_SELECTION_LENGTH = 8_000;

export interface PageSnapshot {
  title: string;
  url: string;
  selectedText: string;
  truncated: boolean;
}

export interface TabState {
  status: 'ready' | 'loading' | 'error';
  page?: PageSnapshot;
  message?: string;
}

export const stateKey = (tabId: number) => `tab:${tabId}`;

export function isSnapshot(value: unknown): value is PageSnapshot {
  if (!value || typeof value !== 'object') return false;
  const page = value as Partial<PageSnapshot>;
  return typeof page.title === 'string' && page.title.length <= 1_000
    && typeof page.url === 'string' && /^https?:\/\//.test(page.url)
    && typeof page.selectedText === 'string' && page.selectedText.length <= MAX_SELECTION_LENGTH
    && typeof page.truncated === 'boolean';
}
