export { format } from 'date-fns'
export { zhCN } from 'date-fns/locale'

// 常用的时间格式化函数
export function formatDateTime(date: Date | number | string): string {
  return format(new Date(date), 'MM-dd HH:mm:ss')
}

export function formatDateTimeWithYear(date: Date | number | string): string {
  return format(new Date(date), 'yyyy-MM-dd HH:mm:ss')
}

export function formatCurrentTime(): string {
  return format(new Date(), 'yyyy-MM-dd HH:mm:ss')
}