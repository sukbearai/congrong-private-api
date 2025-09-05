const TELEGRAM_LIMIT = 4000

function pad(n: number): string { return n < 10 ? '0' + n : '' + n }
export function formatCurrentTime(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
}

export function splitMessage(message: string, limit: number = TELEGRAM_LIMIT): string[] {
  if (message.length <= limit) return [message]
  const parts: string[] = []
  let buffer = ''
  for (const line of message.split('\n')) {
    if ((buffer + line + '\n').length > limit) {
      parts.push(buffer.trimEnd())
      buffer = ''
    }
    buffer += line + '\n'
  }
  if (buffer) parts.push(buffer.trimEnd())
  return parts
}

export function buildHeader(title: string): string {
  // Header ends with a single blank line (two newlines total)
  return `${title}\n⏰ ${formatCurrentTime()}\n\n`
}

export function appendEntry(lines: string[], entry: string) {
  // Ensure each entry is trimmed (no trailing spaces) and ends with exactly one newline
  lines.push(entry.replace(/[ \t]+$/gm, '').trimEnd() + '\n')
}

export function assemble(lines: string[]): string {
  const raw = lines.join('')
  return normalizeMessage(raw)
}

// --- Formatting helpers ----------------------------------------------------

/**
 * Normalize message formatting:
 * - Collapse 3+ consecutive blank lines into exactly 2
 * - Remove trailing spaces before newlines
 * - Trim trailing newlines at end (Telegram 不需要末尾多余空行)
 * - Ensure header blank line separation is preserved
 */
export function normalizeMessage(message: string): string {
  return message
    // Remove trailing spaces on each line
    .replace(/[ \t]+\n/g, '\n')
    // Collapse windows of >=3 newlines to exactly 2
    .replace(/\n{3,}/g, '\n\n')
    // Trim trailing newlines at end
    .replace(/\n+$/,'')
}
