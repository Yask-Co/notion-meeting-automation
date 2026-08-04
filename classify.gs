/**
 * Step 1 — Task → Linear team classification.
 *
 * After the daily meeting/summary pipeline creates Tasks, this step finds
 * rows whose Review Status is still empty, asks Claude (using the live
 * Notion classification guide) to pick Ops / Design / Engineering, and
 * writes Suggested Team + Review Status = "Pending Review".
 *
 * Slack digest (Step 2) runs next via postPendingTasksSlackDigest().
 * Linear sync (Step 3) stays on a separate later trigger.
 *
 * Manual: run classifyUnreviewedTasks() from the Apps Script editor.
 * Automatic: processMeetings_() calls this after the daily summary page
 * is created (same trigger as runDailyJob — not a separate schedule).
 */

var VALID_SUGGESTED_TEAMS_ = { Ops: true, Design: true, Engineering: true };

/**
 * Classifies Tasks with an empty Review Status. PreferIds (optional) are
 * classified first — used by the daily job so newly created tasks are
 * handled before any older backlog. Caps work at CLASSIFY_MAX_PER_RUN.
 *
 * @param {string[]=} preferIds task page IDs to prioritize
 * @returns {{ classified: number, remaining: number, errors: number }}
 */
function classifyUnreviewedTasks(preferIds) {
  Logger.log('classifyUnreviewedTasks: start');

  var guideText = fetchClassificationGuideText_();
  if (!guideText || !guideText.trim()) {
    throw new Error('classifyUnreviewedTasks: classification guide page is empty — ' +
      'check TEAM_CLASSIFICATION_GUIDE_PAGE_ID and that the page has content');
  }

  var pending = fetchTasksWithEmptyReviewStatus_();
  Logger.log('classifyUnreviewedTasks: ' + pending.length + ' task(s) with empty Review Status');

  if (preferIds && preferIds.length) {
    var preferSet = {};
    preferIds.forEach(function(id) { preferSet[id] = true; });
    var preferred = [];
    var rest = [];
    pending.forEach(function(page) {
      if (preferSet[page.id]) preferred.push(page);
      else rest.push(page);
    });
    pending = preferred.concat(rest);
    Logger.log('classifyUnreviewedTasks: prioritizing ' + preferred.length +
      ' newly created task(s)');
  }

  var toProcess = pending.slice(0, CLASSIFY_MAX_PER_RUN);
  var remaining = Math.max(0, pending.length - toProcess.length);
  if (remaining > 0) {
    Logger.log('classifyUnreviewedTasks: processing ' + toProcess.length +
      ' this run (' + remaining + ' left for a later run)');
  }

  var classified = 0;
  var errors = 0;

  toProcess.forEach(function(page) {
    try {
      var team = classifyTaskTeam_(page, guideText);
      notionPatch('/pages/' + page.id, {
        properties: {
          'Suggested Team': { select: { name: team } },
          'Review Status': { select: { name: 'Pending Review' } }
        }
      });
      classified++;
      Logger.log('classifyUnreviewedTasks: ' + page.id + ' → ' + team +
        ' ("' + pageTitle_(page) + '")');
    } catch (e) {
      errors++;
      Logger.log('classifyUnreviewedTasks: FAILED ' + page.id + ' — ' + e.message);
    }
  });

  Logger.log('classifyUnreviewedTasks: done — classified=' + classified +
    ' errors=' + errors + ' remaining=' + remaining);
  return { classified: classified, remaining: remaining, errors: errors };
}

// Queries Tasks where Review Status has no select value yet AND Planning
// is not Done — completed work should not enter the Linear review queue.
function fetchTasksWithEmptyReviewStatus_() {
  var pages = [];
  var cursor = null;

  do {
    var payload = {
      filter: {
        and: [
          { property: 'Review Status', select: { is_empty: true } },
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

// Re-reads the classification guide page from Notion every run.
function fetchClassificationGuideText_() {
  try {
    var blocks = notionGetAllChildren(TEAM_CLASSIFICATION_GUIDE_PAGE_ID);
  } catch (e) {
    throw new Error('classifyUnreviewedTasks: cannot read classification guide page ' +
      TEAM_CLASSIFICATION_GUIDE_PAGE_ID + ' — share it with the Notion integration ' +
      '("Megan S - Clasp Token"). Underlying error: ' + e.message);
  }
  return blocksToPlainText_(blocks);
}

// Asks Claude for exactly one of Ops / Design / Engineering for this task.
function classifyTaskTeam_(taskPage, guideText) {
  var name = pageTitle_(taskPage);
  var notes = richTextPlain_(taskPage.properties['Notes']);
  var projectTitle = relationPageTitle_(taskPage, 'Project');
  var meetingTitle = relationPageTitle_(taskPage, 'Source Meeting');

  var systemPrompt = 'You classify internal action-item tasks into exactly one team for Linear. ' +
    'Use ONLY the classification guide provided by the user, plus the task context. ' +
    'Respond with ONLY one word — Ops, Design, or Engineering — with no punctuation, ' +
    'labels, markdown, or explanation.';

  var userMessage = '=== CLASSIFICATION GUIDE ===\n' + guideText + '\n\n' +
    '=== TASK ===\n' +
    'Name: ' + name + '\n' +
    'Notes: ' + (notes || '(none)') + '\n' +
    'Project: ' + (projectTitle || '(none)') + '\n' +
    'Source Meeting: ' + (meetingTitle || '(none)') + '\n\n' +
    'Which team? Reply with exactly one of: Ops, Design, Engineering';

  var raw = callClaude_(systemPrompt, userMessage, 32, CLASSIFICATION_MODEL);
  var team = String(raw || '').trim();
  // Tolerate accidental wrapping like "Ops." or `"Design"`
  team = team.replace(/^["'`]+|["'`]+$/g, '').replace(/\.$/, '').trim();
  // If the model added a sentence, take the first valid team token.
  if (!VALID_SUGGESTED_TEAMS_[team]) {
    var match = team.match(/\b(Ops|Design|Engineering)\b/);
    if (match) team = match[1];
  }

  if (!VALID_SUGGESTED_TEAMS_[team]) {
    throw new Error('Claude returned invalid team "' + raw + '"');
  }
  return team;
}

function richTextPlain_(prop) {
  if (!prop || prop.type !== 'rich_text' || !prop.rich_text) return '';
  return prop.rich_text.map(function(rt) { return rt.plain_text; }).join('').trim();
}

// Resolves the first related page's title for prompt context, or ''.
function relationPageTitle_(page, propertyName) {
  var prop = page.properties[propertyName];
  var relation = prop && prop.relation;
  if (!relation || relation.length === 0) return '';
  try {
    var related = notionGet('/pages/' + relation[0].id);
    return pageTitle_(related);
  } catch (e) {
    Logger.log('relationPageTitle_: failed for ' + propertyName + ' — ' + e.message);
    return '';
  }
}
