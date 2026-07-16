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

/**
 * One-time setup: adds a "Meeting Date" property (distinct from the
 * auto-generated "Created on") and an "Attendee Names" text property
 * (plain text, not the native people-type Attendees — that type triggers
 * a Notion assignment/mention notification email to everyone listed,
 * which we don't want) to the Meetings database. Run this once before
 * using syncMeetingCalendarFields_(). Safe to run more than once.
 */
function addMeetingDatePropertyToMeetings() {
  Logger.log('addMeetingDatePropertyToMeetings: start');

  notionPatch('/data_sources/' + MEETINGS_DB_ID, {
    properties: {
      'Meeting Date': { date: {} },
      'Attendee Names': { rich_text: {} }
    }
  });

  Logger.log('addMeetingDatePropertyToMeetings: done — "Meeting Date" and "Attendee Names" properties added to Meetings database');
}

/**
 * Sets a meeting page's "Meeting Date" and "Attendee Names" properties
 * from its calendar event (pulled from the transcription block, not
 * written by the user) — the actual meeting time/attendees, as opposed
 * to "Created on" which is just when the Notion page itself was created.
 * Attendees are resolved to plain-text names (not the native people-type
 * Attendees property) specifically to avoid Notion's assignment/mention
 * notification emails going out to everyone listed. No-ops silently if
 * the page has no transcription block or calendar event.
 */
function syncMeetingCalendarFields_(meetingId) {
  var transcriptionBlock = getTranscriptionBlock_(meetingId);
  var calendarEvent = transcriptionBlock && transcriptionBlock.transcription.calendar_event;
  if (!calendarEvent) return;

  var attendeeNames = (calendarEvent.attendees || []).map(function(userId) {
    return notionGet('/users/' + userId).name;
  }).join(', ');

  notionPatch('/pages/' + meetingId, {
    properties: {
      'Meeting Date': { date: { start: calendarEvent.start_time } },
      'Attendee Names': { rich_text: [{ text: { content: attendeeNames } }] }
    }
  });
}

/**
 * One-time backfill: runs syncMeetingCalendarFields_() across every page
 * currently in the Meetings database (not just the last 24 hours), so
 * existing meetings get Meeting Date/Attendees populated too. Safe to run
 * more than once — pages without a transcription block are just skipped.
 */
function backfillMeetingCalendarFields() {
  Logger.log('backfillMeetingCalendarFields: start');

  var meetings = [];
  var cursor   = null;

  do {
    var payload = cursor ? { start_cursor: cursor } : {};
    var result  = notionPost('/data_sources/' + MEETINGS_DB_ID + '/query', payload);

    meetings = meetings.concat(result.results || []);
    cursor   = result.has_more ? result.next_cursor : null;
  } while (cursor);

  Logger.log('backfillMeetingCalendarFields: found ' + meetings.length + ' meeting(s) total');

  meetings.forEach(function(m) {
    syncMeetingCalendarFields_(m.id);
    Logger.log('backfillMeetingCalendarFields: synced ' + m.id);
  });

  Logger.log('backfillMeetingCalendarFields: done');
}
