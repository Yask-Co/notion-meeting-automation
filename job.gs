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

  // Step 1 — classify newly created / still-unreviewed tasks for Linear
  // team suggestion. Soft-fail so a guide/Claude hiccup cannot undo the
  // summary that already succeeded. Slack + Linear sync come later.
  try {
    classifyUnreviewedTasks(taskIds);
  } catch (e) {
    Logger.log('processMeetings_: classifyUnreviewedTasks failed — ' + e.message);
  }

  Logger.log('processMeetings_: complete — summary page ' + summaryPage.url);
  return summaryPage;
}

/**
 * Manual catch-up helper: runs the pipeline for whatever date is set in
 * the CATCHUP_DATE Script Property (format: yyyy-MM-dd, e.g. 2026-07-20).
 * Use this instead of editing code when you need to catch up on a missed
 * day — set the property, click Run on this function, no code changes
 * needed. Update CATCHUP_DATE and re-run for a different day.
 *
 * Warning: if a Daily Summary (and tasks) already exist for that day,
 * this will create DUPLICATE tasks. Use
 * rebuildDailySummaryForConfiguredDate() instead when only the summary
 * page is missing/wrong.
 */
function runCatchUpForConfiguredDate() {
  var configured = parseScriptPropertyDate_('CATCHUP_DATE');
  if (!configured) throw new Error('CATCHUP_DATE not set in Script Properties — set it to a date like 2026-07-20 first');

  Logger.log('runCatchUpForConfiguredDate: catching up on ' + configured.dateStr);
  runDailyJob(configured.date);
}

/**
 * Rebuilds ONLY the Daily Summary page for a date — reuses meetings already
 * in the Meetings database and tasks already linked via Source Meeting.
 * Does NOT re-extract action items, so it won't duplicate tasks.
 *
 * Set Script Property REBUILD_SUMMARY_DATE (yyyy-MM-dd), or falls back to
 * CATCHUP_DATE. Archives any existing Daily summary page(s) for that date
 * first, then writes a fresh one (current Overview / Tasks / Meeting
 * Summaries / Meetings layout).
 *
 * Example: set REBUILD_SUMMARY_DATE=2026-07-24, run this function.
 */
function rebuildDailySummaryForConfiguredDate() {
  var configured = parseScriptPropertyDate_('REBUILD_SUMMARY_DATE') ||
    parseScriptPropertyDate_('CATCHUP_DATE');
  if (!configured) {
    throw new Error('REBUILD_SUMMARY_DATE (or CATCHUP_DATE) not set — set it to a date like 2026-07-24 first');
  }

  Logger.log('rebuildDailySummaryForConfiguredDate: rebuilding summary for ' + configured.dateStr);
  return rebuildDailySummaryForDate_(configured.date);
}

/**
 * Zero-argument convenience for the Apps Script Run button: rebuilds the
 * Friday 2026-07-24 Daily Summary from existing meetings/tasks (no task
 * duplication). Same as setting REBUILD_SUMMARY_DATE=2026-07-24 and running
 * rebuildDailySummaryForConfiguredDate().
 */
function rebuildJuly24DailySummary() {
  return rebuildDailySummaryForDate_(new Date(2026, 6, 24));
}

// Parses a Script Property whose value is yyyy-MM-dd into
// { dateStr, date } using local timezone components (avoids the UTC
// off-by-one that new Date('yyyy-MM-dd') causes). Returns null if unset.
function parseScriptPropertyDate_(propertyName) {
  var dateStr = PropertiesService.getScriptProperties().getProperty(propertyName);
  if (!dateStr) return null;

  var parts = dateStr.split('-').map(Number);
  return { dateStr: dateStr, date: new Date(parts[0], parts[1] - 1, parts[2]) };
}

// Core rebuild: find that day's meetings + their existing tasks, refresh
// calendar attendee fields, archive old Daily summary page(s), create a
// new one with createDailySummaryPage().
function rebuildDailySummaryForDate_(targetDate) {
  var dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  var dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  var dayIso = Utilities.formatDate(dayStart, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var nextIso = Utilities.formatDate(dayEnd, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // Prefer Meeting Date property matches (covers date-only pages too), and
  // also pull calendar_event-timed meetings the same way the nightly job
  // does — then de-dupe by page id.
  var meetingById = {};
  fetchMeetingsWithMeetingDateInRange_(dayIso, nextIso).forEach(function(m) {
    meetingById[m.id] = m;
  });
  fetchNewMeetings(dayStart).forEach(function(m) {
    meetingById[m.id] = m;
  });

  var meetings = Object.keys(meetingById).map(function(id) { return meetingById[id]; });
  if (meetings.length === 0) {
    Logger.log('rebuildDailySummaryForDate_: no meetings found for ' + dayIso + ' — nothing to rebuild');
    return null;
  }

  var meetingIds = meetings.map(function(m) { return m.id; });
  Logger.log('rebuildDailySummaryForDate_: ' + meetingIds.length + ' meeting(s) for ' + dayIso);

  // Refresh attendees before rewriting the summary page body, so the new
  // page picks up Calendar guest lists if access is working now.
  meetingIds.forEach(function(id) {
    try {
      syncMeetingCalendarFields_(id);
    } catch (e) {
      Logger.log('rebuildDailySummaryForDate_: calendar sync failed for ' + id + ' — ' + e.message);
    }
  });

  var taskIds = fetchTaskIdsForMeetings_(meetingIds);
  Logger.log('rebuildDailySummaryForDate_: reusing ' + taskIds.length + ' existing task(s)');

  archiveDailySummariesForDate_(dayIso);

  var summaryPage = createDailySummaryPage(meetingIds, taskIds, dayStart);
  Logger.log('rebuildDailySummaryForDate_: rebuilt — ' + summaryPage.url);
  return summaryPage;
}

// Queries Meetings where Meeting Date is in [startIso, endIso).
function fetchMeetingsWithMeetingDateInRange_(startIso, endIso) {
  var pages = [];
  var cursor = null;

  do {
    var payload = {
      filter: {
        and: [
          { property: 'Meeting Date', date: { on_or_after: startIso } },
          { property: 'Meeting Date', date: { before: endIso } }
        ]
      }
    };
    if (cursor) payload.start_cursor = cursor;

    var result = notionPost('/data_sources/' + MEETINGS_DB_ID + '/query', payload);
    pages = pages.concat(result.results || []);
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);

  return pages;
}

// Collects Tasks whose Source Meeting relation points at any of the given
// meeting IDs — used so rebuild can attach already-created tasks without
// re-running extractActionItems().
function fetchTaskIdsForMeetings_(meetingIds) {
  var taskIds = [];
  var seen = {};

  meetingIds.forEach(function(meetingId) {
    var cursor = null;
    do {
      var payload = {
        filter: { property: 'Source Meeting', relation: { contains: meetingId } }
      };
      if (cursor) payload.start_cursor = cursor;

      var result = notionPost('/data_sources/' + TASKS_DB_ID + '/query', payload);
      (result.results || []).forEach(function(page) {
        if (!seen[page.id]) {
          seen[page.id] = true;
          taskIds.push(page.id);
        }
      });
      cursor = result.has_more ? result.next_cursor : null;
    } while (cursor);
  });

  return taskIds;
}

// Archives existing Type=Daily summary pages dated dayIso so a rebuild
// doesn't leave duplicate Daily Summary pages for the same day.
function archiveDailySummariesForDate_(dayIso) {
  var cursor = null;
  var archived = 0;

  do {
    var payload = {
      filter: {
        and: [
          { property: 'Type', select: { equals: 'Daily' } },
          { property: 'Date', date: { equals: dayIso } }
        ]
      }
    };
    if (cursor) payload.start_cursor = cursor;

    var result = notionPost('/data_sources/' + getSummaryDbId() + '/query', payload);
    (result.results || []).forEach(function(page) {
      notionPatch('/pages/' + page.id, { archived: true });
      archived++;
      Logger.log('archiveDailySummariesForDate_: archived ' + page.id + ' (' + pageTitle_(page) + ')');
    });
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);

  Logger.log('archiveDailySummariesForDate_: archived ' + archived + ' page(s) for ' + dayIso);
}

// Archives existing Type=Weekly summary pages dated weekStartIso so a
// weekly re-run doesn't leave duplicate Weekly Summary pages.
function archiveWeeklySummariesForDate_(weekStartIso) {
  var cursor = null;
  var archived = 0;

  do {
    var payload = {
      filter: {
        and: [
          { property: 'Type', select: { equals: 'Weekly' } },
          { property: 'Date', date: { equals: weekStartIso } }
        ]
      }
    };
    if (cursor) payload.start_cursor = cursor;

    var result = notionPost('/data_sources/' + getSummaryDbId() + '/query', payload);
    (result.results || []).forEach(function(page) {
      notionPatch('/pages/' + page.id, { archived: true });
      archived++;
      Logger.log('archiveWeeklySummariesForDate_: archived ' + page.id + ' (' + pageTitle_(page) + ')');
    });
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);

  Logger.log('archiveWeeklySummariesForDate_: archived ' + archived + ' page(s) for ' + weekStartIso);
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
