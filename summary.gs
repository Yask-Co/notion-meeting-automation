/**
 * Phase 3 — One-time setup: create the "Daily & Weekly Meeting Summary"
 * database as a child of a Notion page you specify, then log its ID so you
 * can store it as a Script Property (SUMMARY_DB_ID).
 *
 * Stub — implement after fetchNewMeetings() is verified.
 */
function setupSummaryDatabase() {
  Logger.log('setupSummaryDatabase: stub called');
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
