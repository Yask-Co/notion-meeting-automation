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
 * linking back to the meeting and task pages created today.
 *
 * Stub — implement after createTaskPages() is verified.
 */
function createDailySummaryPage(meetingIds, taskIds, summaryText) {
  Logger.log('createDailySummaryPage: stub called — ' +
    meetingIds.length + ' meeting(s), ' + taskIds.length + ' task(s)');
}
