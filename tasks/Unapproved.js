const _ = require("lodash")
const minimatch = require("minimatch")

const BaseCommand = require("./BaseCommand")
const UnapprovedRequestDescription = require("./unapproved/UnapprovedRequestDescription")

const logger = require("../utils/logger")
const markupUtils = require("../utils/markup")
const { NetworkError } = require("../utils/errors")

class Unapproved extends BaseCommand {
  perform = () => {
    return this.projects
      .then(projects => Promise.all(projects.map(this.__getApplicableRequests)))
      .then(this.__sortRequests)
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
    const headText = "Hey, there are a couple of requests waiting for your review"
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
    const [toReviewRequests, underReviewRequests, reviewedWithConflicts, reviewedWithFailedPipeline] = _.values(
      _.groupBy(requests, req => {
        switch (true) {
          case req.approvals_left > 0 && !this.__isRequestUnderReview(req):
            return 0 // To review
          case this.__isRequestUnderReview(req):
            return 1 // Under review
          case this.__hasConflicts(req):
            return 2 // Reviewed with conflicts
          default:
            return 3 // Reviewed with failed pipeline
        }
      }),
    )

    const makeSection = _.flow(
      markup.makeBold,
      markup.makeText,
      markup.makePrimaryInfo,
    )

    const sections = [
      { type: "unapproved", name: "Unapproved", requests: toReviewRequests },
      { type: "under_review", name: "Under review", requests: underReviewRequests },
      { type: "conflicts", name: "With conflicts", requests: reviewedWithConflicts },
      { type: "pipeline_failed", name: "With failed pipeline", requests: reviewedWithFailedPipeline },
    ]

    sections.forEach(settings => {
      const section = makeSection(settings.name)
      const sectionMessages = this.__buildGeneralRequestsMessages(
        settings.type, settings.requests, markup,
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

  __hasConflicts = req => this.__getConfigSetting("unapproved.checkConflicts", false) && req.has_conflicts

  __hasFailedPipeline = req => this.__getConfigSetting("unapproved.checkPipeline", false) && 
    req.pipelines[0].status == "failed"

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
    .reduce((prev, field) => prev.then(req => this.__append(field)(project, req)), Promise.resolve(request)) 
    .then(req => ({ ...req, project }))

  __append = field => (project, request) => this.gitlab[field](project.id, request.iid)
    .then(result => (result instanceof Array ? ({ [field]: result, ...request }) : ({ ...result, ...request })))

  __getConfigSetting = (settingName, defaultValue = null) => {
    return _.get(this.config, settingName, defaultValue)
  }
}

module.exports = Unapproved
