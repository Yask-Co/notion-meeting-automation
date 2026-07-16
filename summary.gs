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
 * linking back to the meeting and task pages created today. Body content
 * (meeting list, full copied meeting notes, task list) is built directly
 * from meetingIds/taskIds — no separate summaryText input needed.
 *
 * Run this function directly in the Apps Script editor to verify it
 * creates a summary page before moving to phase 6.
 */
function createDailySummaryPage(meetingIds, taskIds) {
  Logger.log('createDailySummaryPage: start — ' +
    meetingIds.length + ' meeting(s), ' + taskIds.length + ' task(s)');

  var todayLabel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM d, yyyy');
  var todayIso   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var children = [];

  children.push(headingBlock_(2, 'Meetings'));
  meetingIds.forEach(function(meetingId) {
    var page = notionGet('/pages/' + meetingId);
    children.push(linkBulletBlock_(pageTitle_(page), page.url));
  });

  children.push(headingBlock_(2, 'Meeting Notes'));
  meetingIds.forEach(function(meetingId) {
    var page = notionGet('/pages/' + meetingId);
    children.push(headingBlock_(3, pageTitle_(page)));

    var summaryBlocks = getMeetingSummaryBlocks_(meetingId) || [];
    summaryBlocks.forEach(function(block) {
      children.push(toCreatableBlock_(block));
    });
  });

  var summaryPage = notionPost('/pages', {
    parent: { type: 'data_source_id', data_source_id: getSummaryDbId() },
    properties: {
      'Name': { title: [{ text: { content: 'Daily Summary — ' + todayLabel } }] },
      'Date': { date: { start: todayIso } },
      'Type': { select: { name: 'Daily' } },
      'Meetings': { relation: meetingIds.map(function(id) { return { id: id }; }) },
      'Tasks Created': { relation: taskIds.map(function(id) { return { id: id }; }) }
    },
    children: children
  });

  Logger.log('createDailySummaryPage: created — ' + summaryPage.url);
  return summaryPage;
}
