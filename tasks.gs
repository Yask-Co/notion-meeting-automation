/**
 * Phase 4 — Create one page per action item in the Tasks database.
 * Returns an array of the newly created Notion page objects.
 *
 * Run this function directly in the Apps Script editor to verify it
 * creates task pages before moving to phase 5.
 */
function createTaskPages(actionItems) {
  Logger.log('createTaskPages: start — ' + actionItems.length + ' item(s)');

  var createdPages = actionItems.map(function(text) {
    var page = notionPost('/pages', {
      parent: { type: 'data_source_id', data_source_id: TASKS_DB_ID },
      properties: {
        'Name': { title: [{ text: { content: text } }] },
        'Status': { status: { name: 'Not started' } }
      }
    });
    Logger.log('createTaskPages: created — ' + page.url);
    return page;
  });

  Logger.log('createTaskPages: created ' + createdPages.length + ' task page(s)');
  return createdPages;
}
