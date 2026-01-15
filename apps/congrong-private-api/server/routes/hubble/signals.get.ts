import { hubbleApi } from '~/utils/hubble'

export default eventHandler(async (event) => {
  const query = getQuery(event)
  try {
    const res = await hubbleApi.getSignalList({
      name: query.name as string,
      status: query.status as 'ongoing' | 'paused',
      page: Number(query.page) || 1,
      size: Number(query.size) || 10,
    })
    return res
  }
  catch (e) {
    throw createError({
      statusCode: 500,
      statusMessage: String(e),
    })
  }
})
