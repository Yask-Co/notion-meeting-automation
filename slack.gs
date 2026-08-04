/**
 * Step 2 — Slack digest of Tasks awaiting Linear review.
 *
 * After classification, posts one (or more chunked) message(s) to
 * #yask-task-linear listing every Task with Review Status =
 * "Pending Review": name, suggested team, and a Notion link.
 * Skips posting when there are zero pending rows.
 *
 * Manual: run postPendingTasksSlackDigest() from the Apps Script editor.
 * Automatic: processMeetings_() calls this after classifyUnreviewedTasks().
 */

/**
 * Queries Pending Review tasks and posts a digest to Slack.
 * @returns {{ posted: boolean, count: number, messages: number }}
 */
function postPendingTasksSlackDigest() {
  Logger.log('postPendingTasksSlackDigest: start');

  var pending = fetchTasksPendingReview_();
  Logger.log('postPendingTasksSlackDigest: ' + pending.length + ' Pending Review task(s)');

  if (pending.length === 0) {
    Logger.log('postPendingTasksSlackDigest: nothing to post — skipping');
    return { posted: false, count: 0, messages: 0 };
  }

  // Group by Suggested Team for a skimmable digest; unknown/missing last.
  var teamOrder = ['Engineering', 'Design', 'Ops'];
  var byTeam = { Engineering: [], Design: [], Ops: [], Other: [] };
  pending.forEach(function(page) {
    var team = page.properties['Suggested Team'] && page.properties['Suggested Team'].select
      ? page.properties['Suggested Team'].select.name
      : 'Other';
    if (!byTeam[team]) team = 'Other';
    byTeam[team].push(page);
  });

  var lines = [];
  lines.push('*Tasks pending Linear review* (' + pending.length + ')');
  lines.push('Approve / reject in Notion (`Review Status`), then Linear sync will pick up *Approved* rows.');
  lines.push('');

  teamOrder.concat(['Other']).forEach(function(team) {
    var pages = byTeam[team];
    if (!pages || pages.length === 0) return;
    lines.push('*' + team + '* (' + pages.length + ')');
    pages.forEach(function(page) {
      var name = pageTitle_(page) || '(untitled)';
      var url = page.url || notionPageUrl_(page.id);
      // Slack mrkdwn link: <url|label> — escape chars that break mrkdwn lightly
      var safeName = String(name).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&/g, '&amp;');
      lines.push('• <' + url + '|' + safeName + '>');
    });
    lines.push('');
  });

  var chunks = chunkSlackText_(lines.join('\n'), 3500);
  chunks.forEach(function(text, i) {
    slackPostMessage_(SLACK_TASK_LINEAR_CHANNEL_ID, text);
    Logger.log('postPendingTasksSlackDigest: posted chunk ' + (i + 1) + '/' + chunks.length);
  });

  Logger.log('postPendingTasksSlackDigest: done — ' + pending.length + ' task(s) in ' +
    chunks.length + ' message(s)');
  return { posted: true, count: pending.length, messages: chunks.length };
}

function fetchTasksPendingReview_() {
  var pages = [];
  var cursor = null;

  do {
    var payload = {
      filter: {
        and: [
          { property: 'Review Status', select: { equals: 'Pending Review' } },
          { property: 'Planning', status: { does_not_equal: 'Done' } }
        ]
      },
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }]
    };
    if (cursor) payload.start_cursor = cursor;

    var result = notionPost('/data_sources/' + TASKS_DB_ID + '/query', payload);
    pages = pages.concat(result.results || []);
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);

  return pages;
}

function notionPageUrl_(pageId) {
  return 'https://www.notion.so/' + String(pageId || '').replace(/-/g, '');
}

// Splits text into chunks under maxLen, preferring breaks at blank lines.
function chunkSlackText_(text, maxLen) {
  if (text.length <= maxLen) return [text];

  var chunks = [];
  var remaining = text;
  while (remaining.length > maxLen) {
    var slice = remaining.substring(0, maxLen);
    var breakAt = slice.lastIndexOf('\n\n');
    if (breakAt < maxLen * 0.4) breakAt = slice.lastIndexOf('\n');
    if (breakAt < maxLen * 0.4) breakAt = maxLen;
    chunks.push(remaining.substring(0, breakAt).trim());
    remaining = remaining.substring(breakAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function slackPostMessage_(channelId, text) {
  var options = {
    method: 'post',
    headers: {
      Authorization: 'Bearer ' + getSlackBotToken(),
      'Content-Type': 'application/json; charset=utf-8'
    },
    payload: JSON.stringify({
      channel: channelId,
      text: text,
      unfurl_links: false,
      unfurl_media: false
    }),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', options);
  var statusCode = response.getResponseCode();
  var body;
  try {
    body = JSON.parse(response.getContentText());
  } catch (e) {
    throw new Error('Slack API returned non-JSON [' + statusCode + ']: ' +
      response.getContentText().substring(0, 300));
  }

  if (!body.ok) {
    throw new Error('Slack chat.postMessage failed: ' + (body.error || JSON.stringify(body)) +
      ' — ensure SLACK_BOT_TOKEN is set and the bot has joined #yask-task-linear');
  }
  return body;
}
