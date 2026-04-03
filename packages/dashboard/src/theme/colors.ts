/** TypeScript color constants matching tokens.css */

export const colors = {
  bg: {
    base: '#0d1117',
    surface: '#161b22',
    raised: '#1c2128',
    overlay: '#21262d',
    inset: '#090c10',
  },
  text: {
    primary: '#e6edf3',
    secondary: '#8b949e',
    tertiary: '#6e7681',
    disabled: '#484f58',
    link: '#58a6ff',
  },
  accent: '#58a6ff',
  status: {
    running: '#58a6ff',
    success: '#3fb950',
    error: '#f85149',
    warning: '#d29922',
    pending: '#6e7681',
  },
  activity: {
    pipeline: '#bc8cff',
    fix: '#f78166',
    review: '#58a6ff',
    spike: '#7ee787',
    refactor: '#d2a8ff',
    simplify: '#79c0ff',
  },
} as const;

export type ActivityType = keyof typeof colors.activity;

export function activityColor(type: string): string {
  return (colors.activity as Record<string, string>)[type] ?? colors.text.secondary;
}

export function statusColor(status: string): string {
  return (colors.status as Record<string, string>)[status] ?? colors.status.pending;
}
