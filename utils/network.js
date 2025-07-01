const http = require("http")
const https = require("https")
const qs = require("querystring")
const url = require("url")

const logger = require("./logger")
const { NetworkError } = require("./errors")

const getEngine = uri => {
  return uri.protocol === "http:" ? http : https
}

const isErrorStatus = status => status >= 400

const getErrorMessage = ({ response, status, uri }) => {
  const message = response || `${status} Network Error`
  return `Got '${message}' message for '${uri}' request`
}

const get = (to, params = {}, headers = {}) => new Promise((resolve, reject) => {
  const uri = new url.URL(to)
  const engine = getEngine(uri)
  const query = qs.stringify(params)
  const endpoint = query ? `${to}?${query}` : to

  logger.debug(`GET ${endpoint}`)

  engine.get(endpoint, { headers }, resp => {
    let data = ""

    resp.on("data", chunk => (data += chunk))
    resp.on("end", () => {
      const json = JSON.parse(data)

      if (isErrorStatus(resp.statusCode)) {
        const errorMessage = getErrorMessage({ response: data, status: resp.statusCode, uri })
        const error = new NetworkError(errorMessage, resp.statusCode)
        return reject(error)
      }

      json.headers = resp.headers
      resolve(json)
    })
  }).on("error", reject)
})

const post = (to, body, headers = {}) => new Promise((resolve, reject) => {
  const uri = new url.URL(to)
  const engine = getEngine(uri)
  const data = JSON.stringify(body)
  const request = {
    host: uri.host,
    port: uri.port,
    path: uri.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data),
      ...headers,
    },
  }

  logger.debug(`POST ${to} ${data}`)

  const req = engine.request(request, resp => {
    let data = ""
    resp.on("data", chunk => (data += chunk))
    resp.on("end", () => {
      if (isErrorStatus(resp.statusCode)) {
        const errorMessage = getErrorMessage({ response: data, status: resp.statusCode, uri })
        const error = new NetworkError(errorMessage, resp.statusCode)
        return reject(error)
      }

      resolve(data)
    })
  })

  req.on("error", reject)
  req.write(data)
  req.end()
})

module.exports = { get, post }
