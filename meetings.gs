/**
 * Phase 1 — Query the Meetings database for meetings that actually took
 * place on targetDate (by calendar_event.start_time — the real meeting
 * time, not when the Notion page happened to be created). Defaults to
 * today if targetDate is omitted; pass e.g. new Date('2026-07-20') to
 * catch up on a missed prior day. Returns an array of Notion page objects.
 *
 * Run this function directly in the Apps Script editor to verify it finds
 * your recent meeting pages before moving to phase 2.
 */
function fetchNewMeetings(targetDate) {
  Logger.log('fetchNewMeetings: start');

  // Time-based triggers call their handler with an event object (year/month/
  // day/etc.) as the argument, not zero args — checking truthiness alone
  // treated that event object as a real targetDate, producing an Invalid
  // Date and silently zeroing out every automatic run. Only a genuine Date
  // instance (e.g. from runCatchUpForConfiguredDate()) should override "today".
  var dayStart = (targetDate instanceof Date) ? new Date(targetDate) : new Date();
  dayStart.setHours(0, 0, 0, 0);
  var dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  Logger.log('fetchNewMeetings: looking for meetings that took place on ' + dayStart.toDateString());

  var allMeetings = [];
  var cursor = null;

  do {
    var payload = cursor ? { start_cursor: cursor } : {};
    var result  = notionPost('/data_sources/' + MEETINGS_DB_ID + '/query', payload);

    allMeetings = allMeetings.concat(result.results || []);
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);

  // Cheap pre-filter on each page's built-in created_time (already in hand,
  // no extra API call) to a generous recent window, BEFORE the expensive
  // per-meeting block fetch below. Without this, checking every historical
  // meeting's blocks on every run gets slower forever as the database
  // grows — this is what caused a run to exceed Apps Script's execution
  // time limit. 3 days comfortably covers any Calendar backfill delay
  // while keeping the candidate set small under normal daily use.
  var recentCutoffMs = dayStart.getTime() - 3 * 24 * 60 * 60 * 1000;
  var candidates = allMeetings.filter(function(m) {
    return new Date(m.created_time).getTime() > recentCutoffMs;
  });

  // Filtered on the meeting's actual date, not page creation time — those
  // diverge whenever Notion Calendar bulk-syncs/backfills notes, which
  // would otherwise make old meetings look "new."
  var meetings = candidates.filter(function(m) {
    var transcriptionBlock = getTranscriptionBlock_(m.id);
    var calendarEvent = transcriptionBlock && transcriptionBlock.transcription.calendar_event;
    if (!calendarEvent) return false;

    var meetingTime = new Date(calendarEvent.start_time).getTime();
    return meetingTime >= dayStart.getTime() && meetingTime < dayEnd.getTime();
  });

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
 * auto-generated "Created on") and an "Attendee Names" multi-select
 * property (individually filterable tags, not the native people-type
 * Attendees — that type triggers a Notion assignment/mention notification
 * email to everyone listed, which we don't want) to the Meetings database.
 * Run this once before using syncMeetingCalendarFields_(). Safe to run
 * more than once.
 */
function addMeetingDatePropertyToMeetings() {
  Logger.log('addMeetingDatePropertyToMeetings: start');

  notionPatch('/data_sources/' + MEETINGS_DB_ID, {
    properties: {
      'Meeting Date': { date: {} },
      'Attendee Names': { multi_select: {} }
    }
  });

  Logger.log('addMeetingDatePropertyToMeetings: done — "Meeting Date" and "Attendee Names" properties added to Meetings database');
}

/**
 * Finds the Google Calendar event matching a meeting's start/end time and
 * returns its guests' email addresses — internal and external alike,
 * since Google Calendar invites always carry an email regardless of
 * whether that person has any Notion account. Returns [] if no matching
 * event is found.
 */
function getGoogleCalendarAttendeeEmails_(startTime, endTime) {
  var events = CalendarApp.getDefaultCalendar().getEvents(new Date(startTime), new Date(endTime));
  if (events.length === 0) return [];

  return events[0].getGuestList().map(function(guest) { return guest.getEmail(); });
}

/**
 * Sets a meeting page's "Meeting Date" and "Attendee Names" properties
 * from its calendar event (pulled from the transcription block, not
 * written by the user) — the actual meeting time/attendees, as opposed
 * to "Created on" which is just when the Notion page itself was created.
 * Attendees are read directly from the matching Google Calendar event
 * (by email, covering internal and external guests alike) rather than
 * resolved through Notion's /users/{id} endpoint — that only works for
 * workspace members/guests, and separately, writing to a Notion
 * people-type property would trigger an assignment/mention notification
 * email to everyone listed. Reading emails from Google Calendar and
 * writing them as multi-select tags avoids both problems entirely.
 * No-ops silently if the page has no transcription block or calendar event.
 */
function syncMeetingCalendarFields_(meetingId) {
  var transcriptionBlock = getTranscriptionBlock_(meetingId);
  var calendarEvent = transcriptionBlock && transcriptionBlock.transcription.calendar_event;
  if (!calendarEvent) return;

  var attendeeEmails = getGoogleCalendarAttendeeEmails_(calendarEvent.start_time, calendarEvent.end_time);

  notionPatch('/pages/' + meetingId, {
    properties: {
      'Meeting Date': { date: { start: calendarEvent.start_time } },
      'Attendee Names': { multi_select: attendeeEmails.map(function(email) { return { name: email }; }) }
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
