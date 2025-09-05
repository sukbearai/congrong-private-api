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
  return `${title}\n⏰ ${formatCurrentTime()}\n\n`
}

export function appendEntry(lines: string[], entry: string) {
  lines.push(entry.trimEnd() + '\n')
}

export function assemble(lines: string[]): string {
  return lines.join('')
}
