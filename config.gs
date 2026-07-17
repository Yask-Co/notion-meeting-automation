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

// ── Meeting-notes block helpers ─────────────────────────────────────────────

// Finds a meeting page's "transcription" block, or null if the page has no meeting notes.
function getTranscriptionBlock_(pageId) {
  var pageBlocks = notionGetAllChildren(pageId);
  return pageBlocks.filter(function(b) { return b.type === 'transcription'; })[0] || null;
}

// Returns the raw block children of a meeting's summary_block_id, or null
// if the page has no meeting notes or its notes never finished processing
// (no summary_block_id yet — e.g. "no usable meeting notes captured").
function getMeetingSummaryBlocks_(pageId) {
  var transcriptionBlock = getTranscriptionBlock_(pageId);
  var summaryBlockId = transcriptionBlock && transcriptionBlock.transcription.children
    && transcriptionBlock.transcription.children.summary_block_id;
  if (!summaryBlockId) return null;

  return notionGetAllChildren(summaryBlockId);
}

// Extracts the plain-text title from a Notion page object's title property.
function pageTitle_(page) {
  var titleProp = Object.keys(page.properties)
    .map(function(k) { return page.properties[k]; })
    .filter(function(p) { return p.type === 'title'; })[0];

  return titleProp.title.map(function(rt) { return rt.plain_text; }).join('').trim();
}

// Strips a fetched block down to the minimal shape Notion's block-creation
// API accepts. Fetched blocks include read-only/derived fields (e.g.
// numbered_list_item's "list_format") that the create endpoint rejects, so
// this copies only known-safe fields rather than the whole type-specific
// object verbatim.
function toCreatableBlock_(block) {
  var data = block[block.type];
  var safeData = { rich_text: data.rich_text };
  if (data.color !== undefined) safeData.color = data.color;
  if (data.checked !== undefined) safeData.checked = data.checked;
  if (data.is_toggleable !== undefined) safeData.is_toggleable = data.is_toggleable;

  var creatable = { type: block.type };
  creatable[block.type] = safeData;
  return creatable;
}

function headingBlock_(level, text) {
  var block = { type: 'heading_' + level };
  block['heading_' + level] = { rich_text: [{ text: { content: text } }] };
  return block;
}

function linkBulletBlock_(text, url) {
  return {
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ text: { content: text, link: { url: url } } }] }
  };
}
