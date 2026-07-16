/**
 * Phase 2 — Locate the summary block inside the meeting-notes block,
 * parse the "### Action Items" section, and return a clean list of strings.
 *
 * Run this function directly in the Apps Script editor to verify it finds
 * your action items before moving to phase 3.
 */
function extractActionItems(pageId) {
  Logger.log('extractActionItems: start — pageId=' + pageId);

  var summaryBlocks = getMeetingSummaryBlocks_(pageId);

  if (!summaryBlocks) {
    Logger.log('extractActionItems: no transcription block found on page ' + pageId);
    return [];
  }

  var actionItems = [];
  var inActionItems = false;

  summaryBlocks.forEach(function(block) {
    var isHeading = block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3';

    if (isHeading) {
      var headingText = plainTextOf_(block[block.type].rich_text, false).trim().toLowerCase();
      inActionItems = (headingText === 'action items');
      return;
    }

    if (inActionItems && block.type === 'to_do') {
      // Notion appends transcript-citation links as extra rich_text spans with
      // an href — drop those so only the actual item text remains.
      var text = plainTextOf_(block.to_do.rich_text, true).trim();
      if (text) actionItems.push(text);
    }
  });

  Logger.log('extractActionItems: found ' + actionItems.length + ' action item(s)');
  actionItems.forEach(function(item, i) { Logger.log('  ' + i + ': ' + item); });

  return actionItems;
}

function plainTextOf_(richText, excludeLinks) {
  return richText
    .filter(function(rt) { return !excludeLinks || !rt.href; })
    .map(function(rt) { return rt.plain_text; })
    .join('');
}
