// Simple Telegram/MarkdownV2 escape (current tasks mostly use basic Markdown)
// For standard Markdown (not V2) we still escape a conservative subset

const MD_SPECIAL = /([_*[\]()~`>#+\-=|{}.!])/g

export function escapeMarkdown(input: string | undefined | null): string {
  if (!input) { return '' }
  return input.replace(MD_SPECIAL, '\\$1')
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) { return input }
  return `${input.slice(0, max - 1)}…`
}
