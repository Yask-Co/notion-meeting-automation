/**
 * Phase 6 — Orchestrates the full daily pipeline.
 * This is the function the time-based trigger will call (with no
 * arguments, so it always processes today). Pass a Date manually — e.g.
 * runDailyJob(new Date('2026-07-20')) — to catch up on a missed prior day.
 */
function runDailyJob(targetDate) {
  Logger.log('runDailyJob: start');

  // Same instanceof guard as fetchNewMeetings() — normalized once here so
  // the resulting summary page is labeled with the actual day being
  // processed (e.g. a catch-up run) instead of always "today".
  var effectiveDate = (targetDate instanceof Date) ? targetDate : new Date();

  var meetings = fetchNewMeetings(effectiveDate);
  if (meetings.length === 0) {
    Logger.log('runDailyJob: no new meetings found — nothing to do');
    return;
  }

  processMeetings_(meetings, effectiveDate);
}

/**
 * Runs the extract/create-tasks/create-summary pipeline for a given list
 * of meeting page objects (as returned by fetchNewMeetings() or a manual
 * Notion query) — factored out so a subset of meetings can be processed
 * directly without going through fetchNewMeetings()'s 24-hour window.
 * targetDate labels the resulting summary page (defaults to today if
 * omitted, e.g. when called from debug.gs's one-off historical helpers).
 */
function processMeetings_(meetings, targetDate) {
  var meetingIds = meetings.map(function(m) { return m.id; });

  var taskPages = [];
  meetings.forEach(function(meeting) {
    syncMeetingCalendarFields_(meeting.id);
    var actionItems = extractActionItems(meeting.id);

    // Inherit the meeting's own Project relation onto its tasks, if set.
    var projectRelation = meeting.properties['Project'] && meeting.properties['Project'].relation;
    var projectId = (projectRelation && projectRelation.length > 0) ? projectRelation[0].id : null;

    taskPages = taskPages.concat(createTaskPages(actionItems, projectId, meeting.id));
  });

  var taskIds = taskPages.map(function(p) { return p.id; });

  var summaryPage = createDailySummaryPage(meetingIds, taskIds, targetDate);

  Logger.log('processMeetings_: complete — summary page ' + summaryPage.url);
  return summaryPage;
}

/**
 * Manual catch-up helper: runs the pipeline for whatever date is set in
 * the CATCHUP_DATE Script Property (format: yyyy-MM-dd, e.g. 2026-07-20).
 * Use this instead of editing code when you need to catch up on a missed
 * day — set the property, click Run on this function, no code changes
 * needed. Update CATCHUP_DATE and re-run for a different day.
 */
function runCatchUpForConfiguredDate() {
  var dateStr = PropertiesService.getScriptProperties().getProperty('CATCHUP_DATE');
  if (!dateStr) throw new Error('CATCHUP_DATE not set in Script Properties — set it to a date like 2026-07-20 first');

  // A bare "yyyy-MM-dd" string is parsed as midnight UTC by new Date(), which
  // lands on the wrong calendar day once shifted to the script's local
  // timezone. Parsing the components explicitly avoids that off-by-one-day bug.
  var parts = dateStr.split('-').map(Number);
  var targetDate = new Date(parts[0], parts[1] - 1, parts[2]);

  Logger.log('runCatchUpForConfiguredDate: catching up on ' + dateStr);
  runDailyJob(targetDate);
}

/**
 * Phase 7 — One-time setup: installs a daily time-based trigger for
 * runDailyJob() at 8 PM (script timezone). Safe to run more than once —
 * replaces any existing runDailyJob trigger(s) first, so it always
 * converges on the current schedule below rather than silently leaving a
 * stale trigger in place if this function's schedule is ever changed.
 */
function installDailyTrigger() {
  var existing = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === 'runDailyJob';
  });
  existing.forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });

  ScriptApp.newTrigger('runDailyJob')
    .timeBased()
    .atHour(20)
    .everyDays(1)
    .create();

  Logger.log('installDailyTrigger: daily trigger installed for 8 PM' +
    (existing.length ? ' (replaced ' + existing.length + ' existing trigger(s))' : ''));
}
