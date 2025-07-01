const axios = require("axios")

const logger = require("./logger")
const { NetworkError } = require("./errors")

axios.interceptors.request.use(request => {
  const { url, data } = request
  const method = request.method.toUpperCase()

  if (method === "GET") {
    logger.debug(`${method} ${url}`)
  }

  if (method === "POST") {
    logger.debug(`${method} ${url} ${JSON.stringify(data)}`)
  }

  return request
})

const handleError = (url, error) => {
  const status = error.response?.status || 500
  const response = error.response?.data || error.message
  const errorMessage = getErrorMessage({ url, status, response })
  throw new NetworkError(errorMessage, status)
}

const getErrorMessage = ({ url, status, response }) => {
  const message = response || `${status} Network Error`
  return `Got '${message}' message for '${url}' request`
}

const get = async (url, params = {}, headers = {}) => {
  try {
    const resp = await axios.get(url, { headers })
    return resp.data
  } catch (error) {
    handleError(url, error)
  }
}

const post = async (url, params, headers = {}) => {

  try {
    const resp = await axios.post(url, params, { headers })
    return resp.data
  } catch (error) {
    handleError(url, error)
  }
}

module.exports = { get, post }
