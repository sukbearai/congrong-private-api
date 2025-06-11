export default defineEventHandler((event) => {
  if (event.method === 'OPTIONS') {
    return 'ok'
  }
})
