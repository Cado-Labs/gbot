# @cadolabs/gbot

Gitlab bot platform.

## Installation

```sh
$ yarn add @cadolabs/gbot
```

or

```sh
$ npm i @cadolabs/gbot
```

## Usage

### `unapproved`

Sends unapproved MRs to mattermost / slack. MR will be ignored if it has `Draft`/`WIP` mark.

```sh
$ gbot unapproved -c /path/to/config/gbot.yaml
```

## Configuration

Each setting can be set via environment variables.
Each variable must start with `GBOT_` prefix. Double underscore is interpreted as nesting, for example:

```sh
GBOT_GITLAB_TOKEN=token # { "gitlabToken": "token" }
GBOT_GITLAB__TOKEN=token # {"gitlab": { "token": "token" } }
```

Example of the config file:

```yml
messenger:
  url: "<chat.postMessage URL>"        # Slack chat.postMessage endpoint
  token: "<TOKEN>"                     # Slack token with chat:write scope
  channel: "<CHANNEL>"                 # Mattermost / Slack channel where will be messages sent
  markup: "slack"                      # Messenger markup (default - "markdown").
                                       # Possible values:
                                       # - "markdown" (for Mattermost)
                                       # - "slack" (for Slack blocks markup)
                                       # - "slackText" (for Slack text markup)
  sender:
    username: "@cadolabs/gbot"         # Sender's display name
    icon: "<icon url>"                 # Sender's icon url
  slack:                               # Or slackText for slackText
    usernameMapping:
      pavel: "U020DSB741G"             # Mapping of Gitlab username to Slack ID.
                                       # Users without a mapping are shown using
                                       # their Gitlab display name.
gitlab:
  token: "<TOKEN>"                     # GitLab Private Access Token
  url: "<gitlab api url>"              # Gitlab API base url
  groups:                              # List of your project’s groups (optional if projects are defined)
  - id: 4                              # Group id
  - id: 5
    excluded: [1, 2, 3]                # List of projects to exclude from the current group projects (optional)
  - id: 6
    withShared: false                  # Whether to include shared projects or not, defaults to true
  projects:                            # List of your project (optional if groups are defined)
  - id: 42                             # Project id
    paths:                             # List of paths that should be changed in merge requests
    - src/**/*
  - id: 43

# tasks config
unapproved:                            # Config for `unapproved` command
  emoji:                               # Emoji which will be set for each MR (optional)
    24h: ":emoji1:"                    # If MR's last update time more than 24 hours
                                       # Time interval can be set in seconds, minutes,
                                       # hours and days (30s, 10m, 5h, 2d)
    12h: ":emoji2:"                    # If MR's last update time more than 12 hours
    default: ":emoji3:"                # Default emoji (if other ones wasn't matched)
  tag:                                 # Specify who will be tagged in messenger
    approvers: false                   # Tag approvers or not (default - false)
    author: false                      # Tag author of PR or not (default - false)
    commenters: false                  # Tag thread commenters or not (default - false)
    onThreadsOpen: false               # Whether to tag thread authors and PR author when threads are present
    onConflict: false                  # Whether to tag PR author if there are conflicts
    onFailedPipeline: false            # Whether to tag PR author if pipeline is failed
  diffs: false                         # Show changed lines count or not (default - false)
  splitByReviewProgress: false         # Whether to split the requests into those completely without review, those that under review and those with conflicts
  requestsPerMessage: 15               # Merge requests count per message
  checkConflicts: false                # Whether to check PR conflicts
  checkPipeline: false                 # Whether to check if PR pipeline failed
  batches:                             # Send requests in rotating batches instead of all at once (optional)
    enabled: false                     # Whether batching is enabled (default - false)
    period: 4h                         # Length of a single batch slot. Must match how often the bot
                                       # is run (e.g. `4h` for a schedule firing every 4 hours)
    maxRequests: 5                     # Maximum requests per batch
```

### Batches

By default every run sends all pending requests at once, which nobody reads when the list gets long.
With `unapproved.batches` the bot instead splits the list into `ceil(total / maxRequests)` batches and
sends one of them per run, so the whole list is still covered over a full cycle. With 18 requests and
`maxRequests: 5` that is 4 batches: `1-5`, `6-10`, `11-15`, `16-18`, then the cycle starts over.

Requests are ordered by their last update time, so the stalest ones come first. The batch to send is
derived from the current time — `floor(now / period) % batchesCount` — and no state is kept between
runs, which means **`period` must match the interval the bot is actually run at**. With `period: 1h`
and a schedule firing every 4 hours the index would jump by 4 each run and only every fourth batch
would ever be sent.

When `splitByReviewProgress` is enabled, the `With conflicts` and `With failed pipeline` sections are
never batched: those are a call to action for the request author, so they are sent in full every run.
Batches only apply to the `Unapproved` and `Under review` sections. If a cycle happens to contain just
one batch (there are no more requests than `maxRequests`), the message header stays as usual,
otherwise it gets a `(part N of M)` suffix.

Groups in the config are [Gitlab project groups](https://docs.gitlab.com/ee/user/group/). You must specify the group or the project, or both.

## Contributing

Fork it ( https://github.com/Cado-Labs/gbot )
Create your feature branch (git checkout -b feature/my-new-feature)
Commit your changes (git commit -am '[feature_context] Add some feature')
Push to the branch (git push origin feature/my-new-feature)
Create a new Pull Request

## License

Released under MIT License.

## Authors

Created by [Aleksei Bespalov](https://github.com/nulldef).

<a href="https://github.com/Cado-Labs/">
<img style="float: left;" src="https://github.com/Cado-Labs/cado-labs-resources/raw/main/cado_labs_supporting_rounded.svg" alt="Supported by Cado Labs" width="439" height="72">
</a>
