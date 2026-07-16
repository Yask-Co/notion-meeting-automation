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
