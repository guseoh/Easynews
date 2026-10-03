export type ThemePreference = 'system' | 'light' | 'dark';
export type ColorTheme = Exclude<ThemePreference, 'system'>;

export function themePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ColorTheme {
  return preference === 'system' ? systemDark ? 'dark' : 'light' : preference;
}

export function nextTabIndex(key: string, index: number, count: number): number | undefined {
  if (count < 1 || index < 0 || index >= count) return undefined;
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index + count - 1) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return undefined;
}

export function relatedGroupState(followUps: number, background: number) {
  return {
    showCombinedEmpty: followUps === 0 && background === 0,
    showFollowUpEmpty: followUps === 0 && background > 0,
    showBackgroundEmpty: background === 0 && followUps > 0,
  };
}
