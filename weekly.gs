/**
 * Phase 8 — Weekly rollup: gathers the week's Daily Summary pages
 * (Sunday–Saturday), asks Claude for a structured assessment of the
 * week, and writes it as a new "Weekly" page in the Summary database —
 * linking every Meeting/Task the week's Dailies covered. This is the
 * function the weekly time-based trigger will call (with no arguments,
 * so it always processes the week ending today). Pass a Date manually —
 * e.g. runWeeklyJob(new Date('2026-07-25')) — to catch up on a missed
 * prior week.
 */
function runWeeklyJob(targetDate) {
  Logger.log('runWeeklyJob: start');

  // Same instanceof guard used in runDailyJob() — a time-based trigger
  // invokes its handler with an event object, not a real Date, so only a
  // genuine Date instance should override "today".
  var effectiveDate = (targetDate instanceof Date) ? targetDate : new Date();
  var week = weekRangeFor_(effectiveDate);

  Logger.log('runWeeklyJob: covering ' + week.start.toDateString() + ' through ' +
    new Date(week.end.getTime() - 1).toDateString());

  var dailyPages = fetchDailySummariesInRange_(week.start, week.end);
  if (dailyPages.length === 0) {
    Logger.log('runWeeklyJob: no Daily summaries found for this week — nothing to do');
    return;
  }

  Logger.log('runWeeklyJob: found ' + dailyPages.length + ' daily summary page(s)');

  var meetingIds = [];
  var taskIds = [];
  var dailySections = dailyPages.map(function(page) {
    meetingIds = meetingIds.concat(relationIds_(page, 'Meetings'));
    taskIds = taskIds.concat(relationIds_(page, 'Tasks Created'));

    var dateProp = page.properties['Date'] && page.properties['Date'].date;
    var dayLabel = dateProp && dateProp.start
      ? Utilities.formatDate(new Date(dateProp.start), Session.getScriptTimeZone(), 'EEEE, MMM d')
      : pageTitle_(page);

    var blocks = notionGetAllChildren(page.id);
    return '=== ' + dayLabel + ' — ' + pageTitle_(page) + ' ===\n' + blocksToPlainText_(blocks);
  });

  var assessment = requestWeeklyAssessment_(dailySections.join('\n\n'));

  var weeklyPage = createWeeklySummaryPage_(week.start, uniq_(meetingIds), uniq_(taskIds), assessment);

  Logger.log('runWeeklyJob: complete — weekly summary ' + weeklyPage.url);
  return weeklyPage;
}

// Returns { start, end } for the Sunday–Saturday week containing date —
// start is that Sunday at 00:00, end is the *following* Sunday at 00:00
// (exclusive upper bound), so a normal Saturday-evening run covers
// [that week's Sunday, tonight].
function weekRangeFor_(date) {
  var start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay()); // getDay(): Sunday = 0
  var end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { start: start, end: end };
}

// Queries the Summary database for Type=Daily pages whose Date property
// falls in [start, end) — filtered server-side via Notion's query filter,
// handling pagination the same way fetchNewMeetings() does.
function fetchDailySummariesInRange_(start, end) {
  var startIso = Utilities.formatDate(start, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var endIso   = Utilities.formatDate(end, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var pages = [];
  var cursor = null;

  do {
    var payload = {
      filter: {
        and: [
          { property: 'Type', select: { equals: 'Daily' } },
          { property: 'Date', date: { on_or_after: startIso } },
          { property: 'Date', date: { before: endIso } }
        ]
      }
    };
    if (cursor) payload.start_cursor = cursor;

    var result = notionPost('/data_sources/' + getSummaryDbId() + '/query', payload);
    pages = pages.concat(result.results || []);
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);

  return pages;
}

// Extracts a page property's relation IDs (e.g. a Daily Summary's
// "Meetings" or "Tasks Created" relation) as a plain array, or [] if unset.
function relationIds_(page, propertyName) {
  var prop = page.properties[propertyName];
  var relation = prop && prop.relation;
  return relation ? relation.map(function(r) { return r.id; }) : [];
}

// Flattens a page's Notion blocks into plain, readable text for use as
// LLM prompt input — headings become "# "/"## "/"### " lines, list items
// become "- " lines, to-dos show "[x]"/"[ ]". Recurses into has_children
// blocks (fetching their children on demand, since Notion's block-children
// endpoint doesn't inline them), indenting nested content two spaces per level.
function blocksToPlainText_(blocks) {
  return blocks.map(blockToPlainTextLines_).join('\n');
}

function blockToPlainTextLines_(block) {
  var data = block[block.type];
  var text = (data && data.rich_text) ? plainTextOf_(data.rich_text, false) : '';
  var line;

  switch (block.type) {
    case 'heading_1': line = '# ' + text; break;
    case 'heading_2': line = '## ' + text; break;
    case 'heading_3': line = '### ' + text; break;
    case 'to_do':     line = (data.checked ? '[x] ' : '[ ] ') + text; break;
    case 'bulleted_list_item':
    case 'numbered_list_item': line = '- ' + text; break;
    default: line = text;
  }

  if (block.has_children) {
    var childLines = blocksToPlainText_(notionGetAllChildren(block.id));
    line += '\n' + childLines.split('\n').map(function(l) { return '  ' + l; }).join('\n');
  }

  return line;
}

// Sends the week's flattened daily summaries to Claude and parses its
// response as JSON — asking for structured JSON (rather than freeform
// text with section headers) makes parsing reliable instead of fragile
// text-scraping. Falls back to stripping a ```json fence in case the
// model wraps its response despite being told not to.
function requestWeeklyAssessment_(weekText) {
  var systemPrompt = 'You are an assistant that reviews a week of business meeting summaries for a small ' +
    'company and produces a concise weekly assessment. Read the provided daily summaries (spanning one week, ' +
    'Sunday through Saturday) and respond with ONLY valid JSON — no markdown code fences, no commentary before ' +
    'or after — matching exactly this shape: {"overview": string, "themes": [string, ...], ' +
    '"decisions": [string, ...], "risks": [string, ...], "wins": [string, ...], "followUps": [string, ...]}. ' +
    '"overview" is a short narrative paragraph (3-5 sentences) giving a reader who skips everything else a real ' +
    'sense of what happened this week and where things stand — write it as flowing prose, not a list. Each of ' +
    'the other arrays should contain 2-6 short, concrete bullet points drawn only from the provided content; ' +
    'use an empty array for any section with nothing relevant that week. When referring to specific days, use ' +
    'only the weekday/date labels present in the section headers — do not re-derive or shift weekdays.';

  var responseText = callClaude_(systemPrompt, weekText, 2000);

  try {
    return JSON.parse(stripJsonFence_(responseText));
  } catch (e) {
    throw new Error('requestWeeklyAssessment_: failed to parse Claude response as JSON — ' + e.message +
      ' — raw response: ' + responseText.substring(0, 500));
  }
}

function stripJsonFence_(text) {
  return text.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

// Creates the Weekly page in the Summary database: one heading + bulleted
// list per assessment section, linking every Meeting/Task the week's
// Dailies covered.
function createWeeklySummaryPage_(weekStart, meetingIds, taskIds, assessment) {
  var weekEndInclusive = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000); // Saturday
  var startLabel = Utilities.formatDate(weekStart, Session.getScriptTimeZone(), 'MMM d');
  var endLabel   = Utilities.formatDate(weekEndInclusive, Session.getScriptTimeZone(), 'MMM d, yyyy');
  var weekStartIso = Utilities.formatDate(weekStart, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var sections = [
    { key: 'themes',    heading: 'Themes' },
    { key: 'decisions', heading: 'Decisions' },
    { key: 'risks',     heading: 'Risks' },
    { key: 'wins',      heading: 'Wins' },
    { key: 'followUps', heading: 'Follow-Ups' }
  ];

  var children = [];

  // Labeled Overview callout first (same chrome as daily summaries) — a
  // bare unlabeled paragraph above Themes was easy to miss in Notion.
  if (assessment.overview) {
    children = children.concat(overviewSectionBlocks_(assessment.overview));
    children.push(dividerBlock_());
  }

  sections.forEach(function(section) {
    children.push(headingBlock_(2, section.heading));

    var items = assessment[section.key] || [];
    if (items.length === 0) {
      children.push(paragraphBlock_('Nothing notable this week.', { italic: true, color: 'gray' }));
    } else {
      items.forEach(function(item) {
        children.push({
          type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: [{ text: { content: truncateRichTextContent_(item) } }] }
        });
      });
    }
  });

  var weeklyPage = notionPost('/pages', {
    parent: { type: 'data_source_id', data_source_id: getSummaryDbId() },
    properties: {
      'Name': { title: [{ text: { content: 'Weekly Summary — ' + startLabel + '\u2013' + endLabel } }] },
      'Date': { date: { start: weekStartIso } },
      'Type': { select: { name: 'Weekly' } },
      'Meetings': { relation: meetingIds.map(function(id) { return { id: id }; }) },
      'Tasks Created': { relation: taskIds.map(function(id) { return { id: id }; }) }
    }
  });

  appendBlocksInBatches_(weeklyPage.id, children);

  Logger.log('createWeeklySummaryPage_: created — ' + weeklyPage.url);
  return weeklyPage;
}

/**
 * One-time setup: installs a weekly time-based trigger for
 * runWeeklyJob() every Saturday at 8 PM (script timezone), covering
 * that week (Sunday–Saturday). Mirrors installDailyTrigger() — safe to
 * run more than once, replaces any existing runWeeklyJob trigger(s)
 * first so it always converges on the current schedule.
 */
function installWeeklyTrigger() {
  var existing = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === 'runWeeklyJob';
  });
  existing.forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });

  ScriptApp.newTrigger('runWeeklyJob')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(20)
    .create();

  Logger.log('installWeeklyTrigger: weekly trigger installed for Saturday 8 PM' +
    (existing.length ? ' (replaced ' + existing.length + ' existing trigger(s))' : ''));
}
