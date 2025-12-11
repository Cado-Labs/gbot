const _ = require("lodash")
const gitUtils = require("../../utils/git")
const timeUtils = require("../../utils/time")
const stringUtils = require("../../utils/strings")
const markupUtils = require("../../utils/markup")

class UnapprovedRequestDescription {
  constructor (type, request, config) {
    this.type = type
    this.request = request
    this.config = config
  }

  build = () => {
    const markup = this.__markup()

    const { author } = this.request

    const reaction = this.__getEmoji(new Date(this.request.updated_at))
    const link = markup.makeLink(this.request.title, this.request.web_url)
    const projectLink = markup.makeLink(this.request.project.name, this.request.project.web_url)
    const unresolvedAuthors = this.__unresolvedAuthorsString(markup)
    const authorString = this.__authorString(
      markup, author.username, { tag: this.__tagAuthorInPrimaryMessage() },
    )
    const approvedBy = this.__approvedByString(markup)

    const requestMessageParts = [
      reaction,
      markup.makeBold(link),
      `(${projectLink})`,
      this.__optionalDiffString(),
      `by ${authorString}`,
    ]
    const requestMessageText = _.compact(requestMessageParts).join(" ")
    const primaryMessage = markup.makePrimaryInfo(
      markup.makeText(
        requestMessageText,
        { withMentions: this.type === "conflicts" && this.__tagOnConflict() },
      ),
    )
    const secondaryMessageParts = []

    if (unresolvedAuthors.length > 0) {
      const text = `unresolved threads by: ${unresolvedAuthors}`
      const msg = markup.makeText(text, { withMentions: this.__tagOnThreadsOpen() })

      secondaryMessageParts.push(msg)
    }

    if (approvedBy.length > 0) {
      const text = `already approved by: ${approvedBy}`
      const msg = markup.makeText(text, { withMentions: false })

      secondaryMessageParts.push(msg)
    }

    if (this.__hasConflicts()) {
      const authorString = this.__authorString(markup, author.username, { tag: this.__tagOnConflict() })
      const text = `conflicts: ${authorString}`
      const msg = markup.makeText(text, { withMentions: this.__tagOnConflict() })

      secondaryMessageParts.push(msg)
    }

    if (this.__isPipelineFailed()) {
      const authorString = this.__authorString(markup, author.username, { tag: this.__tagOnFailedPipeline() })
      const text = `pipeline failed: ${authorString}`
      const msg = markup.makeText(text, { withMentions: this.__tagOnFailedPipeline() })

      secondaryMessageParts.push(msg)
    }

    const secondaryMessage = markup.makeAdditionalInfo(
      this.type === "conflicts" || this.type === "pipeline_failed" ? [] : secondaryMessageParts,
    )
    return markup.composeBody(primaryMessage, secondaryMessage)
  }

  __markup = () => markupUtils[this.config.messenger.markup]

  __getConfigSetting = (settingName, defaultValue = null) => {
    return _.get(this.config, settingName, defaultValue)
  }

  __getEmoji = lastUpdate => {
    const emoji = this.__getConfigSetting("unapproved.emoji", {})
    const interval = new Date().getTime() - lastUpdate.getTime()

    const findEmoji = _.flow(
      _.partialRight(_.toPairs),
      _.partialRight(_.map, ([key, value]) => [timeUtils.parseInterval(key), value]),
      _.partialRight(_.sortBy, ([time]) => -time),
      _.partialRight(_.find, ([time]) => time < interval),
      _.partialRight(_.last),
    )

    return findEmoji(emoji) || emoji.default || ""
  }

  __unresolvedAuthorsString = (markup) => {
    return this.__unresolvedAuthorsFor(this.request).map(author => (
      this.__authorString(markup, author.username, { tag: true })
    )).join(", ")
  }

  __approvedByString = markup => {
    const tag = this.__getConfigSetting("unapproved.tag.approvers", false)

    return this.request.approved_by.map(approve => (
      this.__authorString(markup, approve.user.username, { tag })
    )).join(", ")
  }

  __authorString = (markup, username, { tag = false } = {}) => {
    if (tag) {
      return this.__getMentionString(markup, username)
    }

    return stringUtils.wrapString(`@${username}`)
  }

  __getMentionString = (markup, username) => {
    const mapping = this.__getConfigSetting(`messenger.${markup.type}.usernameMapping`, {})
    return markup.mention(username, mapping)
  }

  __optionalDiffString = () => {
    const showDiff = this.__getConfigSetting("unapproved.diffs", false)

    if (showDiff) {
      const [ insertions, deletions ] = this.__getTotalDiff()
      return stringUtils.wrapString(`+${insertions} -${deletions}`)
    }

    return ""
  }

  __unresolvedAuthorsFor = () => {
    const tagCommenters = this.__getConfigSetting("unapproved.tag.commenters", false)
    const { discussions } = this.request

    const selectNotes = discussion => {
      const [issueNote, ...comments] = discussion.notes
      return tagCommenters ? [issueNote, ...comments] : [issueNote]
    }

    const userNames = _.flow(
      _.partialRight(
        _.filter,
        discussion => discussion.notes.some(
          note => note.resolvable && !note.resolved,
        ),
      ),
      _.partialRight(_.map, selectNotes),
      _.partialRight(
        _.map,
        notes => notes.map(note => note.author),
      ),
      _.partialRight(_.flatten),
      _.partialRight(
        _.uniqBy,
        author => author.username,
      ),
    )

    return userNames(discussions)
  }

  __getTotalDiff = () => {
    const { changes } = this.request

    const mapDiffs = ({ diff }) => gitUtils.diffToNumericMap(diff)

    return _.flow(
      _.partialRight(_.map, mapDiffs),
      _.flatten,
      _.unzip,
      _.partialRight(_.map, _.sum),
    )(changes)
  }

  __hasConflicts = () => this.__getConfigSetting("unapproved.checkConflicts", false) && this.request.has_conflicts

  __isPipelineFailed = () => this.__getConfigSetting("unapproved.checkPipeline", false) && 
    this.request.pipelines[0].status == "failed"

  __tagAuthorInPrimaryMessage = () => {
    const unresolvedAuthors = this.__unresolvedAuthorsString(this.__markup())
    const tagAuthorOnThread = this.__tagOnThreadsOpen() && unresolvedAuthors.length > 0

    switch (this.type) {
      case "conflicts":
        return this.__tagOnConflict()
      case "pipeline_failed":
        return this.__tagOnFailedPipeline()
      default:
        return this.__shouldTag("author") || tagAuthorOnThread
    }
  }

  __shouldTag = setting => this.__getConfigSetting("unapproved.tag." + setting, false)

  __tagOnConflict = () => this.__shouldTag("onConflict")

  __tagOnFailedPipeline = () => this.__shouldTag("onFailedPipeline")

  __tagOnThreadsOpen = () => this.__shouldTag("onThreadsOpen")
}

module.exports = UnapprovedRequestDescription
