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
 * Sanitizes a string for use as a Notion multi_select option name.
 * Notion rejects commas (and we also strip characters that tend to
 * create noisy room-resource labels).
 */
function sanitizeMultiSelectOptionName_(label) {
  return String(label || '')
    .replace(/,/g, ';')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

/**
 * Finds the Google Calendar event matching a meeting and returns display
 * labels for its guests — prefers each guest's Calendar name (matches
 * cleaned "Attendee Names" options), falling back to email. Still uses
 * multi-select tags (not a people property) so Notion does not send
 * assignment/mention emails.
 *
 * Matching is intentionally picky: getEvents(start, end) returns every
 * overlapping block (Focus Time, OOO, room holds, etc.). Taking
 * events[0] caused Jul 20+ meetings to sync 0 attendees while older
 * meetings (fewer overlapping blocks) still worked. We prefer DEFAULT
 * events, then title similarity to meetingTitle, then guest count.
 */
function getGoogleCalendarAttendeeLabels_(startTime, endTime, meetingTitle) {
  var cal = CalendarApp.getCalendarById(MEETINGS_CALENDAR_ID);
  if (!cal) {
    Logger.log('getGoogleCalendarAttendeeLabels_: getCalendarById(' + MEETINGS_CALENDAR_ID + ') returned null');
    return [];
  }

  // Slightly widen the window so timezone/rounding edge cases still hit.
  var start = new Date(new Date(startTime).getTime() - 60 * 1000);
  var end   = new Date(new Date(endTime).getTime() + 60 * 1000);
  var events = cal.getEvents(start, end);
  if (events.length === 0) {
    Logger.log('getGoogleCalendarAttendeeLabels_: no matching Calendar event found for ' + startTime + ' – ' + endTime);
    return [];
  }

  var scored = events.map(function(event) {
    var guests = event.getGuestList(true);
    var title = event.getTitle() || '';
    var typeName = 'DEFAULT';
    try {
      // Newer Calendar service — Focus Time / OOO / working-location blocks
      // often overlap meeting times and have an empty guest list.
      if (event.getEventType) typeName = String(event.getEventType());
    } catch (e) {}

    var score = 0;
    // Prefer normal meetings; heavily penalize Focus Time / OOO / working-location
    // blocks that often overlap and have empty guest lists.
    if (/FOCUS|OUT_OF_OFFICE|WORKING_LOCATION|BIRTHDAY|FROM_GMAIL/i.test(typeName)) {
      score -= 100;
    } else {
      score += 100;
    }
    if (guests.length > 0) score += 50 + guests.length;
    if (meetingTitle) score += titleSimilarityScore_(meetingTitle, title);

    Logger.log('getGoogleCalendarAttendeeLabels_: candidate "' + title +
      '" type=' + typeName + ' guests=' + guests.length + ' score=' + score);

    return { event: event, guests: guests, title: title, score: score };
  });

  scored.sort(function(a, b) { return b.score - a.score; });
  var best = scored[0];
  Logger.log('getGoogleCalendarAttendeeLabels_: chose "' + best.title + '" (score=' + best.score +
    ', ' + scored.length + ' overlapping event(s))');

  return resolveAttendeeLabelsForGuests_(best.event, best.guests);
}

/**
 * Prefer human names whenever Google has one:
 *   1. CalendarApp guest.getName()
 *   2. Calendar API v3 attendee.displayName / organizer.displayName (often
 *      populated when CalendarApp leaves getName() empty)
 *   3. Google Contacts full name for that email
 *   4. Email as last resort
 */
function resolveAttendeeLabelsForGuests_(calendarAppEvent, guests) {
  var displayNameByEmail = fetchCalendarApiDisplayNamesForEvent_(calendarAppEvent);

  return guests.map(function(guest) {
    var email = (guest.getEmail() || '').trim();
    var emailKey = email.toLowerCase();
    var name = (guest.getName() || '').trim();

    if (!name && emailKey && displayNameByEmail[emailKey]) {
      name = displayNameByEmail[emailKey];
    }
    if (!name && email) {
      name = lookupContactNameByEmail_(email);
    }

    return sanitizeMultiSelectOptionName_(name || email);
  }).filter(function(label) { return !!label; });
}

// Calendar API v3 often includes displayName for Workspace users even when
// CalendarApp's getName() is blank — use the script's existing Calendar OAuth.
function fetchCalendarApiDisplayNamesForEvent_(event) {
  var map = {};
  try {
    var icalId = event.getId();
    var url = 'https://www.googleapis.com/calendar/v3/calendars/' +
      encodeURIComponent(MEETINGS_CALENDAR_ID) +
      '/events?iCalUID=' + encodeURIComponent(icalId) +
      '&maxResults=5';
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      Logger.log('fetchCalendarApiDisplayNamesForEvent_: HTTP ' + response.getResponseCode() +
        ' — ' + response.getContentText().substring(0, 200));
      return map;
    }

    var items = JSON.parse(response.getContentText()).items || [];
    if (items.length === 0) return map;

    var apiEvent = items[0];
    (apiEvent.attendees || []).forEach(function(attendee) {
      if (attendee.email && attendee.displayName) {
        map[String(attendee.email).toLowerCase()] = String(attendee.displayName).trim();
      }
    });
    if (apiEvent.organizer && apiEvent.organizer.email && apiEvent.organizer.displayName) {
      map[String(apiEvent.organizer.email).toLowerCase()] = String(apiEvent.organizer.displayName).trim();
    }
  } catch (e) {
    Logger.log('fetchCalendarApiDisplayNamesForEvent_: ' + e.message);
  }
  return map;
}

function lookupContactNameByEmail_(email) {
  try {
    var contacts = ContactsApp.getContactsByEmailAddress(email);
    if (!contacts || contacts.length === 0) return '';
    var fullName = (contacts[0].getFullName() || '').trim();
    return fullName;
  } catch (e) {
    // Contacts scope may be missing — safe to ignore; email fallback still works.
    return '';
  }
}

// Rough title similarity for picking the right overlapping Calendar event —
// strips the trailing ISO timestamp Notion often appends to meeting titles.
function titleSimilarityScore_(notionTitle, calendarTitle) {
  var a = normalizeMeetingTitle_(notionTitle);
  var b = normalizeMeetingTitle_(calendarTitle);
  if (!a || !b) return 0;
  if (a === b) return 40;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return 25;

  var aWords = a.split(' ').filter(function(w) { return w.length > 2; });
  var shared = 0;
  aWords.forEach(function(w) {
    if (b.indexOf(w) !== -1) shared++;
  });
  return Math.min(20, shared * 5);
}

function normalizeMeetingTitle_(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.\-+z]+/gi, '')
    .replace(/[^a-z0-9+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sets a meeting page's "Meeting Date" and "Attendee Names" properties
 * from its calendar event (pulled from the transcription block, not
 * written by the user) — the actual meeting time/attendees, as opposed
 * to "Created on" which is just when the Notion page itself was created.
 * Attendees prefer human names whenever Google provides one (CalendarApp
 * name → Calendar API displayName → Contacts), then email. Writing
 * multi-select tags avoids Notion people-property mention emails.
 *
 * If Calendar yields zero guests, leaves any existing Attendee Names
 * alone (still updates Meeting Date) so a bad match cannot wipe a
 * previously good backfill.
 *
 * Does not touch "Meeting Type".
 */
function syncMeetingCalendarFields_(meetingId) {
  var page = notionGet('/pages/' + meetingId);
  var transcriptionBlock = getTranscriptionBlock_(meetingId);
  var calendarEvent = transcriptionBlock && transcriptionBlock.transcription.calendar_event;
  if (!calendarEvent) {
    Logger.log('syncMeetingCalendarFields_: ' + meetingId + ' — no calendar_event on transcription block, skipping');
    return;
  }

  var attendeeLabels = getGoogleCalendarAttendeeLabels_(
    calendarEvent.start_time,
    calendarEvent.end_time,
    pageTitle_(page)
  );
  Logger.log('syncMeetingCalendarFields_: ' + meetingId + ' — event ' + calendarEvent.start_time + ' – ' +
    calendarEvent.end_time + ' — ' + attendeeLabels.length + ' attendee(s): ' + attendeeLabels.join(', '));

  var properties = {
    'Meeting Date': { date: { start: calendarEvent.start_time } }
  };

  if (attendeeLabels.length > 0) {
    properties['Attendee Names'] = {
      multi_select: attendeeLabels.map(function(label) { return { name: label }; })
    };
  } else {
    Logger.log('syncMeetingCalendarFields_: ' + meetingId +
      ' — 0 Calendar guests; leaving existing Attendee Names unchanged');
  }

  notionPatch('/pages/' + meetingId, { properties: properties });
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

  var failures = [];
  meetings.forEach(function(m) {
    try {
      syncMeetingCalendarFields_(m.id);
    } catch (e) {
      // Without this, one bad meeting (e.g. a 400 from a stale property
      // name) would throw and silently abort every meeting after it in
      // the batch, with no indication in the log of how far it got.
      failures.push(m.id);
      Logger.log('backfillMeetingCalendarFields: FAILED on ' + m.id + ' — ' + e.message);
    }
  });

  Logger.log('backfillMeetingCalendarFields: done — ' + (meetings.length - failures.length) + '/' +
    meetings.length + ' succeeded' + (failures.length ? ', failed: ' + failures.join(', ') : ''));
}
