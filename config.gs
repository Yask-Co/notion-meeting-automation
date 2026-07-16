// ── Notion API constants ────────────────────────────────────────────────────

var NOTION_API_VERSION = '2025-09-03';
var NOTION_BASE_URL    = 'https://api.notion.com/v1';

var MEETINGS_DB_ID = '39b2d514-fe3a-803d-b5bb-000bc511b02f';
var TASKS_DB_ID    = '39b2d514-fe3a-809f-87ad-000bfb8b7851';

// Page shared with the integration to hold the Summary database (setupSummaryDatabase() creates it as a child of this page).
var SUMMARY_PARENT_PAGE_ID = '39f2d514-fe3a-80cf-8008-fdb0ef4ab43f';

// ── Script Properties accessors ─────────────────────────────────────────────

function getNotionToken() {
  var token = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!token) throw new Error('NOTION_TOKEN not set in Script Properties');
  return token;
}

function getSummaryDbId() {
  var id = PropertiesService.getScriptProperties().getProperty('SUMMARY_DB_ID');
  if (!id) throw new Error('SUMMARY_DB_ID not set in Script Properties — run setupSummaryDatabase() first');
  return id;
}

// ── Low-level Notion HTTP helpers ────────────────────────────────────────────

function notionRequest_(method, path, payload) {
  var options = {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + getNotionToken(),
      'Notion-Version': NOTION_API_VERSION,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };
  if (payload) options.payload = JSON.stringify(payload);

  var response = UrlFetchApp.fetch(NOTION_BASE_URL + path, options);
  var body = JSON.parse(response.getContentText());

  if (body.object === 'error') {
    throw new Error('Notion API error [' + body.status + ']: ' + body.message + ' (path=' + path + ')');
  }
  return body;
}

function notionGet(path)            { return notionRequest_('get',   path, null);    }
function notionPost(path, payload)  { return notionRequest_('post',  path, payload); }
function notionPatch(path, payload) { return notionRequest_('patch', path, payload); }

// Fetches ALL children of a block, handling Notion's 100-result pagination.
function notionGetAllChildren(blockId) {
  var results = [];
  var cursor  = null;

  do {
    var qs   = cursor ? '?start_cursor=' + cursor : '';
    var page = notionGet('/blocks/' + blockId + '/children' + qs);
    results  = results.concat(page.results || []);
    cursor   = page.has_more ? page.next_cursor : null;
  } while (cursor);

  return results;
}
