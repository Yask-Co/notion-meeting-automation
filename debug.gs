/**
 * Temporary diagnostic — checks whether the integration can see a real
 * Calendar-synced meeting note page, and logs its raw block structure so
 * we can see how Notion's public API actually represents "summary" /
 * "Action Items" content (as opposed to the pretty-printed view other
 * tools may show). Delete once extractActionItems() is built.
 */
function debugDumpMeetingPage() {
  var pageId = '39f2d514-fe3a-808c-9ca2-d4a0e94b22ee'; // "test block" meeting note (now DB-linked and accessible)

  Logger.log('debugDumpMeetingPage: fetching page metadata for ' + pageId);
  var page = notionGet('/pages/' + pageId);
  Logger.log('Page object: ' + JSON.stringify(page));

  Logger.log('debugDumpMeetingPage: fetching block children');
  var children = notionGetAllChildren(pageId);
  Logger.log('debugDumpMeetingPage: found ' + children.length + ' top-level block(s)');

  children.forEach(function(block, i) {
    Logger.log('--- block ' + i + ' ---');
    Logger.log(JSON.stringify(block));
  });
}

/**
 * Confirms which Notion workspace "Megan S - Clasp Token" is actually
 * scoped to, by asking the API who the bot itself is. If this doesn't
 * match the workspace where the meeting notes live, that's the whole bug.
 */
function debugWhoAmI() {
  var me = notionGet('/users/me');
  Logger.log('debugWhoAmI: ' + JSON.stringify(me));
}

/**
 * Diagnostic for the "no matching Calendar event found" failures seen
 * across every single meeting in backfillMeetingCalendarFields() — a
 * 100% failure rate, which points at CalendarApp.getDefaultCalendar()
 * resolving to the wrong calendar entirely (e.g. a personal calendar,
 * when the actual meetings live on a separate/shared calendar) rather
 * than a per-meeting matching issue. Logs which calendar is "default",
 * every other calendar this account can see, and every event that
 * actually exists on the default calendar in the window where the
 * missing meetings should be — so we can tell at a glance whether the
 * default calendar is simply empty (wrong account/calendar) or has
 * events with different times/titles than expected (a different bug).
 */
function debugInspectDefaultCalendar() {
  var defaultCal = CalendarApp.getDefaultCalendar();
  Logger.log('debugInspectDefaultCalendar: default calendar — id=' + defaultCal.getId() +
    '  name="' + defaultCal.getName() + '"');

  var allCalendars = CalendarApp.getAllCalendars();
  Logger.log('debugInspectDefaultCalendar: ' + allCalendars.length + ' calendar(s) accessible to this account total:');
  allCalendars.forEach(function(cal) {
    Logger.log('  id=' + cal.getId() + '  name="' + cal.getName() + '"');
  });

  // Wide window covering every meeting backfillMeetingCalendarFields()
  // just failed to match (2026-07-07 through 2026-07-22).
  var start = new Date(2026, 6, 6);
  var end   = new Date(2026, 6, 23);
  var events = defaultCal.getEvents(start, end);
  Logger.log('debugInspectDefaultCalendar: ' + events.length +
    ' event(s) found on the DEFAULT calendar between ' + start + ' and ' + end + ':');
  events.forEach(function(e) {
    Logger.log('  "' + e.getTitle() + '"  ' + e.getStartTime() + ' – ' + e.getEndTime());
  });
}

/**
 * Verifies the script's running account can actually access
 * MEETINGS_CALENDAR_ID. getCalendarById() returns null (not an
 * exception) if that calendar hasn't been shared with the running
 * account, or shared with too low a permission level to see event
 * details/guests — run this after setting up calendar sharing to
 * confirm it actually worked before relying on it in production.
 */
function debugVerifyMeetingsCalendarAccess() {
  var cal = CalendarApp.getCalendarById(MEETINGS_CALENDAR_ID);
  if (!cal) {
    Logger.log('debugVerifyMeetingsCalendarAccess: getCalendarById(' + MEETINGS_CALENDAR_ID + ') returned null — ' +
      'not shared with this account, or the calendar ID is wrong.');
    return;
  }

  Logger.log('debugVerifyMeetingsCalendarAccess: accessible — name="' + cal.getName() + '"');

  var start = new Date(2026, 6, 6);
  var end   = new Date(2026, 6, 23);
  var events = cal.getEvents(start, end);
  Logger.log('debugVerifyMeetingsCalendarAccess: ' + events.length + ' event(s) found between ' + start + ' and ' + end + ':');
  events.forEach(function(e) {
    var guests = e.getGuestList(true).map(function(g) { return g.getEmail(); });
    Logger.log('  "' + e.getTitle() + '"  ' + e.getStartTime() + ' – ' + e.getEndTime() + '  guests=' + guests.join(', '));
  });
}

/**
 * Zero-argument wrapper so the Apps Script editor's Run button can
 * exercise extractActionItems() against the known test meeting.
 */
function debugTestExtractActionItems() {
  extractActionItems('39f2d514-fe3a-808c-9ca2-d4a0e94b22ee');
}

/**
 * Zero-argument wrapper chaining extractActionItems() -> createTaskPages()
 * against the known test meeting, so the Run button can exercise Phase 4.
 */
function debugTestCreateTaskPages() {
  var actionItems = extractActionItems('39f2d514-fe3a-808c-9ca2-d4a0e94b22ee');
  createTaskPages(actionItems);
}

/**
 * Zero-argument wrapper exercising createDailySummaryPage() against the
 * known test meeting and the 3 task pages already created from it.
 */
function debugTestCreateDailySummaryPage() {
  createDailySummaryPage(
    ['39f2d514-fe3a-808c-9ca2-d4a0e94b22ee'],
    ['39f2d514-fe3a-81d5-b1bd-f99a4dbdcb50', '39f2d514-fe3a-8188-a4b8-d48db6bc0b00', '39f2d514-fe3a-81fa-bdd6-f1a97ea20bc4']
  );
}

/**
 * Zero-argument wrapper exercising syncMeetingCalendarFields_() against a
 * known test meeting, without running the full pipeline (which would
 * create duplicate task pages).
 */
function debugTestSyncMeetingCalendarFields() {
  syncMeetingCalendarFields_('39f2d514-fe3a-81d4-8983-ec64bf3c29bc'); // "Plan: Gathering Place Ethno" — only Megan is an attendee
  Logger.log('debugTestSyncMeetingCalendarFields: done');
}

/**
 * One-off catch-up run: processes only the 4 genuinely new meetings from
 * the 2026-07-16/17 backlog-migration incident, skipping the 13 stale
 * historical meetings that got bulk-migrated into the Meetings database
 * at the same time and would otherwise look "new" to fetchNewMeetings().
 */
function debugCatchUpGenuinelyNewMeetings() {
  var meetingIds = [
    '3a02d514-fe3a-80e7-875c-e826c704163e', // Andolini's x Yask Discovery
    '3a02d514-fe3a-80ae-a31b-ef3b7316504a', // Yask x Andolini's Internal Follow-up
    '39f2d514-fe3a-8093-957c-c2195413f14f', // Meghan + Megan 1:1
    '39f2d514-fe3a-805e-87b8-c764dcf9a340'  // Plan: Moreau Brothers Meeting
  ];

  var meetings = meetingIds.map(function(id) { return notionGet('/pages/' + id); });
  processMeetings_(meetings);
}

/**
 * One-off: the 2026-07-16/17 catch-up run already created 12 real task
 * pages for "Andolini's x Yask Discovery" before crashing on the summary
 * page step (toCreatableBlock_ bug, since fixed). This finishes just the
 * summary page using those already-created task IDs, so the tasks aren't
 * duplicated by re-running the full catch-up.
 */
function debugFinishCatchUpSummaryOnly() {
  var meetingIds = [
    '3a02d514-fe3a-80e7-875c-e826c704163e',
    '3a02d514-fe3a-80ae-a31b-ef3b7316504a',
    '39f2d514-fe3a-8093-957c-c2195413f14f',
    '39f2d514-fe3a-805e-87b8-c764dcf9a340'
  ];
  var taskIds = [
    '3a02d514-fe3a-81c8-aec2-d166f86d1932',
    '3a02d514-fe3a-81f3-addf-ee7032aefecd',
    '3a02d514-fe3a-81a4-8c16-ee9ec33d2017',
    '3a02d514-fe3a-8192-9d75-c31b575d30df',
    '3a02d514-fe3a-819e-b0f5-f0fd73dd8fb4',
    '3a02d514-fe3a-818a-aef9-fe008d766a55',
    '3a02d514-fe3a-8109-97f2-cd3f2a8dee2c',
    '3a02d514-fe3a-816a-b113-d1fbacfb7c4b',
    '3a02d514-fe3a-81fc-872a-d5eb47f043de',
    '3a02d514-fe3a-81c8-82a5-de0c3580f664',
    '3a02d514-fe3a-811c-b8e7-f0c1ad5b2923',
    '3a02d514-fe3a-81ed-9b56-f001e4e6db13'
  ];

  createDailySummaryPage(meetingIds, taskIds);
}

/**
 * One-off: the 2026-07-20 catch-up run already created 15 real task pages
 * across 3 meetings before crashing on the summary page step (100-block
 * limit, since fixed). This finishes just the summary page using those
 * already-created task IDs, so the tasks aren't duplicated by re-running
 * the full catch-up.
 */
function debugFinishJuly20SummaryOnly() {
  var meetingIds = [
    '3a32d514-fe3a-8162-95ef-e113427427f3', // Yask 90 Day OKR Session
    '3a32d514-fe3a-80a6-9efb-e2779d359c41', // Gearhead Demo Debrief
    '3a32d514-fe3a-805c-b237-de6754a1237e'  // Gearhead Discovery Call YASK
  ];
  var taskIds = [
    '3a42d514-fe3a-8125-84f6-d4100ececdc1',
    '3a42d514-fe3a-814a-8426-c3aa956edc77',
    '3a42d514-fe3a-811e-ab5a-efd4d7927d5a',
    '3a42d514-fe3a-8101-adf6-e0ac5ff70fee',
    '3a42d514-fe3a-81da-87c3-c9a3fb40108a',
    '3a42d514-fe3a-81f8-a9bc-c9f2f9012d86',
    '3a42d514-fe3a-8142-a834-e1fd6a599b53',
    '3a42d514-fe3a-81a8-851d-d03248050214',
    '3a42d514-fe3a-8117-998d-f9d69360856d',
    '3a42d514-fe3a-8142-9057-ea002d54379b',
    '3a42d514-fe3a-817c-94ac-ec94d7bd30ed',
    '3a42d514-fe3a-81d2-8aed-e55bdabf8b94',
    '3a42d514-fe3a-812d-a1c4-ef1feaf33f9c',
    '3a42d514-fe3a-81f4-b4f4-ff42e9e763d0',
    '3a42d514-fe3a-8142-a6df-d0daa901689d'
  ];

  createDailySummaryPage(meetingIds, taskIds);
}

/**
 * Removes any existing runDailyJob triggers (e.g. a stale one installed
 * at the wrong hour), so installDailyTrigger() can be re-run cleanly to
 * install the current schedule.
 */
function debugDeleteDailyJobTriggers() {
  var triggers = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === 'runDailyJob';
  });

  triggers.forEach(function(t) { ScriptApp.deleteTrigger(t); });

  Logger.log('debugDeleteDailyJobTriggers: removed ' + triggers.length + ' trigger(s)');
}

/**
 * Dumps the raw block children of a meeting note's summary block, so we
 * can see exactly how Notion stores the "### Action Items" markdown text
 * (literal text in a paragraph vs. native heading/to_do blocks) before
 * writing extractActionItems().
 */
function debugDumpSummaryBlock() {
  var summaryBlockId = '39f2d514-fe3a-80e1-84fd-e610fe01450f'; // "test block" meeting's summary_block_id

  var children = notionGetAllChildren(summaryBlockId);
  Logger.log('debugDumpSummaryBlock: found ' + children.length + ' block(s)');

  children.forEach(function(block, i) {
    Logger.log('--- summary block ' + i + ' ---');
    Logger.log(JSON.stringify(block));
  });
}
