const _ = require("lodash")
const minimatch = require("minimatch")

const BaseCommand = require("./BaseCommand")
const UnapprovedRequestDescription = require("./unapproved/UnapprovedRequestDescription")

const logger = require("../utils/logger")
const markupUtils = require("../utils/markup")
const timeUtils = require("../utils/time")
const userUtils = require("../utils/users")
const { NetworkError } = require("../utils/errors")

const PINNED_TYPES = ["conflicts", "pipeline_failed"]

class Unapproved extends BaseCommand {
  __userNames = new Map()
  __batch = null

  perform = () => {
    return this.projects
      .then(projects => Promise.all(projects.map(this.__getApplicableRequests)))
      .then(this.__sortRequests)
      .then(this.__selectBatch)
      .then(this.__buildMessages)
      .then(this.__logMessages)
      .then(this.messenger.sendMany)
      .catch(err => {
        if (err instanceof NetworkError) {
          logger.error(err)
        } else {
          console.error(err) // eslint-disable-line no-console
        }

        process.exit(1)
      })
  }

  __buildMessages = requests => {
    const markup = markupUtils[this.__getConfigSetting("messenger.markup")]

    if (requests.length) {
      return this.__buildListMessages(requests, markup)
    } else {
      return this.__buildEmptyListMessage(markup)
    }
  }

  __logMessages = messages => {
    this.logger.info("Sending messages")
    this.logger.info(JSON.stringify(messages))
    return messages
  }

  __buildListMessages = (requests, markup) => {
    const headText = this.__headText()
    const messages = this.__buildRequestsMessages(requests, markup)
    const header = markup.makeHeader(headText)

    return messages.map((message, idx) => {
      const parts = markup.flatten(message)

      if (idx === 0) {
        return markup.composeMsg(
          markup.withHeader(header, parts),
        )
      }

      return markup.composeMsg(parts)
    })
  }

  __buildRequestsMessages = (requests, markup) => {
    const splitByReviewProgress =
      this.__getConfigSetting("unapproved.splitByReviewProgress")

    if (splitByReviewProgress) {
      return this.__buildByReviewProgressMessages(requests, markup)
    }

    return this.__buildGeneralRequestsMessages("unapproved", requests, markup)
  }

  __buildEmptyListMessage = markup => {
    const headText = "Hey, there is a couple of nothing"
    const bodyText = "There are no pending requests! Let's do a new one!"

    const header = markup.makeHeader(headText)
    const body = markup.makePrimaryInfo(markup.makeText(bodyText))

    return markup.composeMsg(markup.withHeader(header, body))
  }

  __buildByReviewProgressMessages = (requests, markup) => {
    const messages = []
    const groups = _.groupBy(requests, this.__reviewProgressType)

    const makeSection = _.flow(
      markup.makeBold,
      markup.makeText,
      markup.makePrimaryInfo,
    )

    const sections = [
      { type: "unapproved", name: "Unapproved" },
      { type: "under_review", name: "Under review" },
      { type: "conflicts", name: "With conflicts" },
      { type: "pipeline_failed", name: "With failed pipeline" },
    ]

    sections.forEach(settings => {
      const section = makeSection(settings.name)
      const sectionMessages = this.__buildGeneralRequestsMessages(
        settings.type, groups[settings.type] || [], markup,
      )

      sectionMessages.forEach((chunk, idx) => {
        messages.push(idx === 0 ? [section, ...chunk] : chunk)
      })
    })

    return messages
  }

  __buildGeneralRequestsMessages = (type, requests, markup) => (
    this.__chunkRequests(requests).map(chunk => (
      chunk.map(request => this.__buildRequestDescription(type, request)).map(markup.addDivider)
    ))
  )

  __chunkRequests = requests => {
    const requestsPerMessage = this.__getConfigSetting("unapproved.requestsPerMessage", 10000)

    return _.chunk(requests, requestsPerMessage)
  }

  __buildRequestDescription = (type, request) =>
    new UnapprovedRequestDescription(type, request, this.config).build()

  __sortRequests = requests => requests
    .flat().sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at))

  __selectBatch = requests => {
    if (!this.__getConfigSetting("unapproved.batches.enabled", false)) return requests

    const batchSize = this.__batchSize()
    const [pinnedRequests, rotatedRequests] = _.partition(requests, this.__isPinnedRequest)

    if (rotatedRequests.length <= batchSize) return requests

    const batches = _.chunk(rotatedRequests, batchSize)
    const index = this.__currentBatchIndex(batches.length)
    const selected = new Set([...pinnedRequests, ...batches[index]])

    this.__batch = { index, count: batches.length }
    this.logger.info(`Sending batch ${index + 1} of ${batches.length}`)

    return requests.filter(request => selected.has(request))
  }

  __currentBatchIndex = count => Math.floor(Date.now() / this.__batchPeriod()) % count

  __batchSize = () => {
    const size = this.__getConfigSetting("unapproved.batches.maxRequests")

    if (!_.isInteger(size) || size < 1) {
      throw new Error("unapproved.batches.maxRequests must be a positive integer")
    }

    return size
  }

  __batchPeriod = () => {
    const period = this.__getConfigSetting("unapproved.batches.period")
    const interval = _.isString(period) ? timeUtils.parseInterval(period) : 0

    if (!interval) {
      throw new Error("unapproved.batches.period must be an interval, such as 30m, 4h or 2d")
    }

    return interval
  }

  __isPinnedRequest = request =>
    this.__getConfigSetting("unapproved.splitByReviewProgress", false) &&
      PINNED_TYPES.includes(this.__reviewProgressType(request))

  __reviewProgressType = request => {
    switch (true) {
      case request.approvals_left > 0 && !this.__isRequestUnderReview(request):
        return "unapproved"
      case this.__isRequestUnderReview(request):
        return "under_review"
      case this.__hasConflicts(request):
        return "conflicts"
      default:
        return "pipeline_failed"
    }
  }

  __headText = () => {
    const text = "Hey, there are a couple of requests waiting for your review"

    if (!this.__batch) return text

    return `${text} (part ${this.__batch.index + 1} of ${this.__batch.count})`
  }

  __getApplicableRequests = project => this.__getExtendedRequests(project.id)
    .then(requests => requests.filter(req => {
      const isCompleted = !req.work_in_progress
      const isUnapproved = req.approvals_left > 0
      const hasPathsChanges = this.__hasPathsChanges(req.changes, project.paths)
      const isApplicable = isUnapproved || this.__isRequestUnderReview(req) ||
        this.__hasConflicts(req) || this.__hasFailedPipeline(req)

      return isCompleted && hasPathsChanges && isApplicable
    }))

  __isRequestUnderReview = req => req.discussions
    .some(dis => dis.notes
      .some(note => note.resolvable && !note.resolved))

  __hasPathsChanges = (changes, paths) => {
    if (_.isEmpty(paths)) {
      return true
    }

    return changes.some(change => (
      paths.some(path => (
        minimatch(change.old_path, path) || minimatch(change.new_path, path)
      ))
    ))
  }

  __hasConflicts = req => this.__getConfigSetting("unapproved.checkConflicts", false) &&
    req.has_conflicts

  __hasFailedPipeline = req => this.__getConfigSetting("unapproved.checkPipeline", false) &&
    req.pipelines[0].status == "failed" // eslint-disable-line eqeqeq

  __getExtendedRequests = projectId => {
    return this.gitlab
      .project(projectId)
      .then(project => this.gitlab
        .requests(project.id)
        .then(requests => {
          const promises = requests.map(request => this.__getExtendedRequest(project, request))
          return Promise.all(promises)
        }),
      )
  }

  __getExtendedRequest = (project, request) => ["approvals", "changes", "discussions", "pipelines"]
    .reduce(
      (prev, field) => prev.then(req => this.__append(field)(project, req)),
      Promise.resolve(request),
    )
    .then(this.__resolveUserNames)
    .then(req => ({ ...req, project }))

  // GitLab hides the name of access token bots in embedded user objects, so look
  // the real one up per user. Cached, and only for users we got no name for.
  __resolveUserNames = request => this.__fetchMissingNames(request).then(names => {
    if (names.size === 0) return request

    const patch = user => (user && names.has(user.id)
      ? { ...user, name: names.get(user.id) }
      : user)

    return {
      ...request,
      author: patch(request.author),
      approved_by: (request.approved_by || []).map(approve => (
        { ...approve, user: patch(approve.user) }
      )),
      discussions: (request.discussions || []).map(dis => (
        { ...dis, notes: dis.notes.map(note => ({ ...note, author: patch(note.author) })) }
      )),
    }
  })

  __fetchMissingNames = request => {
    const users = _.uniqBy(this.__usersWithoutName(request), user => user.id)
    const names = new Map()

    return Promise.all(users.map(user => this.__fetchUserName(user.id).then(name => {
      if (userUtils.hasName({ name })) names.set(user.id, name)
    }))).then(() => names)
  }

  __usersWithoutName = request => [
    request.author,
    ...(request.approved_by || []).map(approve => approve.user),
    ...(request.discussions || []).flatMap(dis => dis.notes.map(note => note.author)),
  ].filter(user => user && !userUtils.hasName(user))

  __fetchUserName = id => {
    if (!this.__userNames.has(id)) {
      this.__userNames.set(id, this.gitlab.user(id).then(user => user.name).catch(() => null))
    }

    return this.__userNames.get(id)
  }

  __append = field => (project, request) => this.gitlab[field](project.id, request.iid)
    .then(result => (result instanceof Array
      ? ({ [field]: result, ...request })
      : ({ ...result, ...request })))

  __getConfigSetting = (settingName, defaultValue = null) => {
    return _.get(this.config, settingName, defaultValue)
  }
}

module.exports = Unapproved
