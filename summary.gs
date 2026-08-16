/**
 * Phase 3 — One-time setup: create the "Daily & Weekly Meeting Summary"
 * database as a child of SUMMARY_PARENT_PAGE_ID. Logs the new data source
 * ID so you can save it as the SUMMARY_DB_ID Script Property. Safe to run
 * more than once, but each run creates a fresh database — only run again
 * if you intend to replace the old one.
 */
function setupSummaryDatabase() {
  Logger.log('setupSummaryDatabase: creating database');

  var database = notionPost('/databases', {
    parent: { type: 'page_id', page_id: SUMMARY_PARENT_PAGE_ID },
    title: [{ text: { content: 'Daily & Weekly Meeting Summary' } }],
    initial_data_source: {
      properties: {
        'Name': { title: {} },
        'Date': { date: {} },
        'Type': {
          select: { options: [{ name: 'Daily', color: 'blue' }, { name: 'Weekly', color: 'green' }] }
        },
        'Meetings': {
          relation: { data_source_id: MEETINGS_DB_ID, type: 'single_property', single_property: {} }
        },
        'Tasks Created': {
          relation: { data_source_id: TASKS_DB_ID, type: 'single_property', single_property: {} }
        }
      }
    }
  });

  var summaryDataSourceId = database.data_sources[0].id;
  Logger.log('setupSummaryDatabase: database created — ' + database.url);
  Logger.log('setupSummaryDatabase: SUMMARY_DB_ID = ' + summaryDataSourceId);
  Logger.log('setupSummaryDatabase: save the ID above as the SUMMARY_DB_ID Script Property');

  return summaryDataSourceId;
}

/**
 * Phase 5 — Create the daily summary page in the Summary database,
 * linking back to the meeting and task pages created for targetDate
 * (defaults to today if omitted — e.g. debug.gs's one-off historical
 * helpers that don't pass it). Body content (overview, tasks, meeting
 * notes, meeting index) is built directly from meetingIds/taskIds —
 * no separate summaryText input needed.
 *
 * Run this function directly in the Apps Script editor to verify it
 * creates a summary page before moving to phase 6.
 */
function createDailySummaryPage(meetingIds, taskIds, targetDate) {
  Logger.log('createDailySummaryPage: start — ' +
    meetingIds.length + ' meeting(s), ' + taskIds.length + ' task(s)');

  // Labels the page with the day actually being processed, not necessarily
  // today — e.g. a catch-up run for a missed prior day should produce a
  // summary titled/dated for that day, not the day the catch-up happened to run.
  var labelDate = (targetDate instanceof Date) ? targetDate : new Date();
  var todayLabel = Utilities.formatDate(labelDate, Session.getScriptTimeZone(), 'MMMM d, yyyy');
  // Weekday included so Claude can reference the calendar day accurately
  // instead of guessing (the weekly overview previously shifted weekdays
  // by one when left to infer them).
  var dayLabelWithWeekday = Utilities.formatDate(labelDate, Session.getScriptTimeZone(), 'EEEE, MMMM d, yyyy');
  var todayIso   = Utilities.formatDate(labelDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // Fetched once per meeting/task and reused below, rather than
  // refetching per section.
  var meetingPages = meetingIds.map(function(meetingId) { return notionGet('/pages/' + meetingId); });
  var taskPages    = taskIds.map(function(taskId) { return notionGet('/pages/' + taskId); });

  var meetingTitleById = {};
  meetingPages.forEach(function(page) { meetingTitleById[page.id] = pageTitle_(page); });

  // Pre-fetch each meeting's summary blocks once — used both as Claude
  // input and as the page body, so we don't hit Notion twice per meeting.
  var meetingSummaries = meetingPages.map(function(page) {
    return {
      page: page,
      blocks: getMeetingSummaryBlocks_(page.id) || []
    };
  });

  var overview = requestDailyOverview_(
    buildDailyOverviewInput_(meetingSummaries, taskPages, dayLabelWithWeekday),
    dayLabelWithWeekday
  );

  // Page order optimized for skimming in Notion:
  //   1. Overview — one narrative paragraph (callout) for "what happened"
  //   2. Tasks — actionable follow-ups up front, not buried after notes
  //   3. Meeting Summaries — full detail when you want to dig in
  //   4. Meetings — compact index (title / time / attendees)
  // Dividers between major sections give the page clear visual rhythm
  // without any extra API cost.
  var children = [];

  if (overview) {
    children = children.concat(overviewSectionBlocks_(overview));
    children.push(dividerBlock_());
  }

  children.push(headingBlock_(2, 'Tasks'));
  if (taskPages.length === 0) {
    children.push(noTasksParagraphBlock_());
  } else {
    taskPages.forEach(function(page) {
      children.push(taskSummaryBulletBlock_(page, meetingTitleById));
    });
  }

  children.push(dividerBlock_());
  children.push(headingBlock_(2, 'Meeting Summaries'));
  meetingSummaries.forEach(function(entry) {
    children.push(headingBlock_(3, pageTitle_(entry.page)));

    var metaBlock = meetingMetaParagraphBlock_(entry.page);
    if (metaBlock) children.push(metaBlock);

    entry.blocks.forEach(function(block) {
      children.push(toCreatableBlock_(block));
    });
  });

  children.push(dividerBlock_());
  children.push(headingBlock_(2, 'Meetings'));
  meetingPages.forEach(function(page) {
    children.push(meetingSummaryBulletBlock_(page));
  });

  // Page creation only accepts up to 100 children in one call — create the
  // page with just properties, then append all the body content in batches.
  var summaryPage = notionPost('/pages', {
    parent: { type: 'data_source_id', data_source_id: getSummaryDbId() },
    properties: {
      'Name': { title: [{ text: { content: 'Daily Summary — ' + todayLabel } }] },
      'Date': { date: { start: todayIso } },
      'Type': { select: { name: 'Daily' } },
      'Meetings': { relation: meetingIds.map(function(id) { return { id: id }; }) },
      'Tasks Created': { relation: taskIds.map(function(id) { return { id: id }; }) }
    }
  });

  appendBlocksInBatches_(summaryPage.id, children);

  Logger.log('createDailySummaryPage: created — ' + summaryPage.url);
  return summaryPage;
}

// Flattens today's meetings + tasks into plain text for the daily overview
// prompt — same blocksToPlainText_() helper the weekly rollup uses, so
// Claude sees readable headings/bullets rather than raw Notion JSON.
function buildDailyOverviewInput_(meetingSummaries, taskPages, dayLabel) {
  var sections = ['Date: ' + dayLabel];

  meetingSummaries.forEach(function(entry) {
    var meta = meetingMetaLabel_(entry.page);
    var header = '=== Meeting: ' + pageTitle_(entry.page) +
      (meta ? ' (' + meta + ')' : '') + ' ===';
    sections.push(header + '\n' + blocksToPlainText_(entry.blocks));
  });

  if (taskPages.length > 0) {
    sections.push(
      '=== Tasks created ===\n' +
      taskPages.map(function(page) { return '- ' + pageTitle_(page); }).join('\n')
    );
  } else {
    sections.push('=== Tasks created ===\n(none)');
  }

  return sections.join('\n\n');
}

// Asks Claude for a single narrative overview paragraph for the day.
// Soft-fails (returns null + logs) on API/parse errors so a Claude outage
// never blocks the rest of the daily pipeline from writing the summary
// page — unlike the weekly job, the daily run is the critical path.
function requestDailyOverview_(dayText, dayLabel) {
  var systemPrompt = 'You are an assistant that reviews one day of business meeting notes for a small ' +
    'company and produces a concise daily overview. The date of this day is "' + dayLabel + '". ' +
    'Respond with ONLY valid JSON — no markdown code fences, no commentary before or after — matching ' +
    'exactly this shape: {"overview": string}. "overview" is a short narrative paragraph (3-5 sentences) ' +
    'giving a reader who skips everything else a real sense of what happened today and where things stand — ' +
    'write it as flowing prose, not a list. Draw only from the provided content. When referring to the day, ' +
    'use the provided date label exactly — do not invent or shift weekdays.';

  try {
    var responseText = callClaude_(systemPrompt, dayText, 500);
    var parsed = JSON.parse(stripJsonFence_(responseText));
    if (!parsed.overview || typeof parsed.overview !== 'string') {
      Logger.log('requestDailyOverview_: Claude response missing overview string — skipping overview');
      return null;
    }
    return parsed.overview.trim();
  } catch (e) {
    Logger.log('requestDailyOverview_: failed (' + e.message + ') — creating daily page without overview');
    return null;
  }
}
