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
