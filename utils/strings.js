const wrapString = (string, wrapper = "`") => {
  return `${wrapper}${string}${wrapper}`
}

const sanitizeString = (string) => {
  return string.replace(/[<>|@#&`]/g, "");
}

module.exports = {
  wrapString,
  sanitizeString
}
