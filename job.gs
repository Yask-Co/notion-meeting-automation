/**
 * Phase 6 — Orchestrates the full daily pipeline.
 * This is the function the time-based trigger will call.
 *
 * Run this function directly in the Apps Script editor to verify the
 * whole pipeline end-to-end before installing the daily trigger.
 */
function runDailyJob() {
  Logger.log('runDailyJob: start');

  var meetings = fetchNewMeetings();
  if (meetings.length === 0) {
    Logger.log('runDailyJob: no new meetings found — nothing to do');
    return;
  }

  var meetingIds = meetings.map(function(m) { return m.id; });

  var taskPages = [];
  meetings.forEach(function(meeting) {
    var actionItems = extractActionItems(meeting.id);

    // Inherit the meeting's own Project relation onto its tasks, if set.
    var projectRelation = meeting.properties['Project'] && meeting.properties['Project'].relation;
    var projectId = (projectRelation && projectRelation.length > 0) ? projectRelation[0].id : null;

    taskPages = taskPages.concat(createTaskPages(actionItems, projectId, meeting.id));
  });

  var taskIds = taskPages.map(function(p) { return p.id; });

  var summaryPage = createDailySummaryPage(meetingIds, taskIds);

  Logger.log('runDailyJob: complete — summary page ' + summaryPage.url);
}

/**
 * Phase 7 — One-time setup: installs a daily time-based trigger for
 * runDailyJob() at 6 AM (script timezone). Safe to run more than once;
 * will not create duplicate triggers.
 */
function installDailyTrigger() {
  var alreadyInstalled = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === 'runDailyJob';
  });

  if (alreadyInstalled) {
    Logger.log('installDailyTrigger: trigger already exists — skipping');
    return;
  }

  ScriptApp.newTrigger('runDailyJob')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();

  Logger.log('installDailyTrigger: daily trigger installed for 6 AM');
}
