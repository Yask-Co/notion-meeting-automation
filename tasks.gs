/**
 * Phase 4 — Create one page per action item in the Tasks database.
 * If projectId is given, every created task's Project relation is set to
 * it (used to inherit the source meeting's Project). Due date and any
 * assignee are left unset — reliably inferring those from the item text
 * would need real language understanding, not just property copying.
 * Returns an array of the newly created Notion page objects.
 *
 * Run this function directly in the Apps Script editor to verify it
 * creates task pages before moving to phase 5.
 */
function createTaskPages(actionItems, projectId) {
  Logger.log('createTaskPages: start — ' + actionItems.length + ' item(s)');

  var createdPages = actionItems.map(function(text) {
    var properties = {
      'Name': { title: [{ text: { content: text } }] },
      'Status': { status: { name: 'Not started' } }
    };
    if (projectId) {
      properties['Project'] = { relation: [{ id: projectId }] };
    }

    var page = notionPost('/pages', {
      parent: { type: 'data_source_id', data_source_id: TASKS_DB_ID },
      properties: properties
    });
    Logger.log('createTaskPages: created — ' + page.url);
    return page;
  });

  Logger.log('createTaskPages: created ' + createdPages.length + ' task page(s)');
  return createdPages;
}
