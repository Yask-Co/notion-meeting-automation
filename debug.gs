/**
 * Temporary diagnostic — checks whether the integration can see a real
 * Calendar-synced meeting note page, and logs its raw block structure so
 * we can see how Notion's public API actually represents "summary" /
 * "Action Items" content (as opposed to the pretty-printed view other
 * tools may show). Delete once extractActionItems() is built.
 */
function debugDumpMeetingPage() {
  var pageId = '39e2d514-fe3a-816f-9e3c-fc540c68fdad'; // "Sync on Ramp" meeting note

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
