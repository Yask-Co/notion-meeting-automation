/**
 * Phase 1 — Query the Meetings database for any pages created in the last 24 hours.
 * Returns an array of Notion page objects.
 *
 * Run this function directly in the Apps Script editor to verify it finds
 * your recent meeting pages before moving to phase 2.
 */
function fetchNewMeetings() {
  Logger.log('fetchNewMeetings: start');

  var since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  Logger.log('fetchNewMeetings: looking for meetings created after ' + since);

  var meetings = [];
  var cursor   = null;

  do {
    var payload = {
      filter: {
        property: 'Created on',
        created_time: { after: since }
      },
      sorts: [{ property: 'Created on', direction: 'ascending' }]
    };
    if (cursor) payload.start_cursor = cursor;

    var result = notionPost('/data_sources/' + MEETINGS_DB_ID + '/query', payload);

    meetings = meetings.concat(result.results || []);
    cursor   = result.has_more ? result.next_cursor : null;
  } while (cursor);

  Logger.log('fetchNewMeetings: found ' + meetings.length + ' meeting(s)');

  meetings.forEach(function(m) {
    var nameProp = m.properties['Name'];
    var title = (nameProp && nameProp.title && nameProp.title.length > 0)
      ? nameProp.title[0].plain_text
      : '(untitled)';
    Logger.log('  page_id=' + m.id + '  title="' + title + '"');
  });

  return meetings;
}
