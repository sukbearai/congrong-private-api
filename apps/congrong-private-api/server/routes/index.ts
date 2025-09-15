export default eventHandler(async (event) => {
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  return 'Hello World,I am Suk.Bear!😊🔥'
})
