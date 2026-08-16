/**
 * Step 3 — Sync Approved Notion Tasks to Linear.
 *
 * Runs on its own schedule (see installLinearSyncTrigger), a couple hours
 * after the daily classify + Slack digest, so humans have time to set
 * Review Status in Notion. Only rows with Review Status = "Approved" are
 * turned into Linear issues (team Triage). Pending Review rows are left
 * alone and will appear again in tomorrow's Slack digest until approved
 * or rejected.
 *
 * Project assignment is intentionally not required — team + Triage only
 * for now (optional Suggested Project can come later).
 *
 * Manual: run syncApprovedTasksToLinear() from the Apps Script editor.
 */

/**
 * Creates Linear issues for every Approved (non-Done) Task, writes
 * Linear URL back to Notion, and sets Review Status = Synced.
 * @returns {{ synced: number, skipped: number, errors: number }}
 */
function syncApprovedTasksToLinear() {
  Logger.log('syncApprovedTasksToLinear: start');

  if (!ENABLE_TASK_PIPELINE) {
    Logger.log('syncApprovedTasksToLinear: ENABLE_TASK_PIPELINE=false — skipping Linear sync');
    return { synced: 0, skipped: 0, errors: 0 };
  }

  var approved = fetchTasksApprovedForLinear_();
  Logger.log('syncApprovedTasksToLinear: ' + approved.length + ' Approved task(s)');

  var synced = 0;
  var skipped = 0;
  var errors = 0;

  approved.forEach(function(page) {
    try {
      var existingUrl = page.properties['Linear URL'] && page.properties['Linear URL'].url;
      if (existingUrl) {
        // Already linked — mark Synced so we don't recreate forever.
        notionPatch('/pages/' + page.id, {
          properties: {
            'Review Status': { select: { name: 'Synced' } }
          }
        });
        skipped++;
        Logger.log('syncApprovedTasksToLinear: already had Linear URL, marked Synced — ' +
          page.id + ' ' + existingUrl);
        return;
      }

      var teamName = page.properties['Suggested Team'] && page.properties['Suggested Team'].select
        ? page.properties['Suggested Team'].select.name
        : null;
      var teamConfig = teamName && LINEAR_TEAMS[teamName];
      if (!teamConfig) {
        throw new Error('missing/invalid Suggested Team "' + teamName + '"');
      }

      var title = pageTitle_(page) || 'Untitled task';
      var notes = richTextPlain_(page.properties['Notes']);
      var description = buildLinearDescription_(page, notes);

      var issue = linearCreateIssue_({
        title: title,
        description: description,
        teamId: teamConfig.teamId,
        stateId: teamConfig.triageStateId
      });

      notionPatch('/pages/' + page.id, {
        properties: {
          'Linear URL': { url: issue.url },
          'Review Status': { select: { name: 'Synced' } }
        }
      });

      synced++;
      Logger.log('syncApprovedTasksToLinear: ' + page.id + ' → ' + issue.identifier +
        ' (' + teamName + ') ' + issue.url);
    } catch (e) {
      errors++;
      Logger.log('syncApprovedTasksToLinear: FAILED ' + page.id + ' — ' + e.message);
    }
  });

  Logger.log('syncApprovedTasksToLinear: done — synced=' + synced +
    ' skipped=' + skipped + ' errors=' + errors);
  return { synced: synced, skipped: skipped, errors: errors };
}

/**
 * One-time setup: installs a daily trigger for syncApprovedTasksToLinear()
 * at 10 PM (script timezone) — two hours after the 8 PM daily job, so
 * Pending Review items can be approved in Notion first. Safe to re-run;
 * replaces any existing syncApprovedTasksToLinear trigger(s).
 */
function installLinearSyncTrigger() {
  var existing = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === 'syncApprovedTasksToLinear';
  });
  existing.forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });

  ScriptApp.newTrigger('syncApprovedTasksToLinear')
    .timeBased()
    .atHour(22)
    .everyDays(1)
    .create();

  Logger.log('installLinearSyncTrigger: Linear sync trigger installed for 10 PM' +
    (existing.length ? ' (replaced ' + existing.length + ' existing trigger(s))' : ''));
}

/**
 * Removes the 10 PM Linear sync trigger. Safe to run when the task
 * pipeline is disabled so Approved rows are not pushed overnight.
 */
function removeLinearSyncTrigger() {
  var existing = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === 'syncApprovedTasksToLinear';
  });
  existing.forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  Logger.log('removeLinearSyncTrigger: removed ' + existing.length + ' trigger(s)');
}

function fetchTasksApprovedForLinear_() {
  var pages = [];
  var cursor = null;

  do {
    var payload = {
      filter: {
        and: [
          { property: 'Review Status', select: { equals: 'Approved' } },
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

function buildLinearDescription_(page, notes) {
  var parts = [];
  if (notes) parts.push(notes);
  parts.push('');
  parts.push('---');
  parts.push('Source: [Notion task](' + (page.url || notionPageUrl_(page.id)) + ')');
  var meetingTitle = relationPageTitle_(page, 'Source Meeting');
  if (meetingTitle) parts.push('Source meeting: ' + meetingTitle);
  return parts.join('\n').trim();
}

function linearCreateIssue_(input) {
  var data = linearGraphql_({
    query: 'mutation IssueCreate($input: IssueCreateInput!) {' +
      '  issueCreate(input: $input) {' +
      '    success' +
      '    issue { id identifier url title }' +
      '  }' +
      '}',
    variables: {
      input: {
        title: input.title,
        description: input.description || '',
        teamId: input.teamId,
        stateId: input.stateId
      }
    }
  });

  var payload = data.issueCreate;
  if (!payload || !payload.success || !payload.issue) {
    throw new Error('Linear issueCreate unsuccessful: ' + JSON.stringify(data).substring(0, 300));
  }
  return payload.issue;
}

function linearGraphql_(body) {
  var options = {
    method: 'post',
    headers: {
      Authorization: getLinearApiKey(),
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch('https://api.linear.app/graphql', options);
  var statusCode = response.getResponseCode();
  var parsed;
  try {
    parsed = JSON.parse(response.getContentText());
  } catch (e) {
    throw new Error('Linear API returned non-JSON [' + statusCode + ']: ' +
      response.getContentText().substring(0, 300));
  }

  if (parsed.errors && parsed.errors.length) {
    throw new Error('Linear GraphQL error: ' + parsed.errors.map(function(err) {
      return err.message;
    }).join('; '));
  }
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error('Linear HTTP [' + statusCode + ']: ' + response.getContentText().substring(0, 300));
  }
  return parsed.data;
}
