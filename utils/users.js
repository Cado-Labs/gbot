// GitLab omits the real name of access token bots in embedded user objects,
// returning a placeholder like "****" instead of the name /users reports.
const MEANINGFUL_NAME = /[\p{L}\p{N}]/u

const hasName = ({ name }) => MEANINGFUL_NAME.test(name || "")

const displayName = user => (hasName(user) ? user.name : user.username)

module.exports = { displayName, hasName }
