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
 * helpers that don't pass it). Body content (meeting list, full copied
 * meeting notes, task list) is built directly from meetingIds/taskIds —
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
  var todayIso   = Utilities.formatDate(labelDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // Fetched once per meeting and reused below, rather than fetching each
  // meeting page twice (once per section).
  var meetingPages = meetingIds.map(function(meetingId) { return notionGet('/pages/' + meetingId); });

  var children = [];

  children.push(headingBlock_(2, 'Meetings'));
  meetingPages.forEach(function(page) {
    children.push(linkBulletBlock_(pageTitle_(page), page.url));
  });

  children.push(headingBlock_(2, 'Meeting Notes'));
  meetingPages.forEach(function(page) {
    children.push(headingBlock_(3, pageTitle_(page)));

    var summaryBlocks = getMeetingSummaryBlocks_(page.id) || [];
    summaryBlocks.forEach(function(block) {
      children.push(toCreatableBlock_(block));
    });
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
