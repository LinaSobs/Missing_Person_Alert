// Use the real ASP.NET Core API by default. Browser-local mode is opt-in for offline UI demos.
const LOCAL_DATA_MODE = import.meta.env.VITE_USE_LOCAL_DATA === 'true';
const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5068').replace(/\/$/, '');
const KEYS = {
  cases: 'missing_person_alert_cases_v3',
  sightings: 'missing_person_alert_sightings_v3',
  users: 'missing_person_alert_users_v3',
  notifications: 'missing_person_alert_notifications_v3',
  subscriptions: 'missing_person_alert_subscriptions_v3'
};

export const resolveMediaUrl = (path) => !path ? '' : (/^https?:\/\//i.test(path) ? path : `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`);

function readStore(key, initial = []) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
    localStorage.setItem(key, JSON.stringify(initial));
    return initial;
  } catch {
    return initial;
  }
}

function writeStore(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function allCases() {
  return readStore(KEYS.cases, []);
}

// One-time cleanup of specifically requested old browser-local reports and linked data.
// A marker prevents future reports using the same names from being removed.
function cleanupRequestedLocalReportsOnce() {
  const markerKey = 'missing_person_alert_named_report_cleanup_v1';

  try {
    if (localStorage.getItem(markerKey) === 'complete') return;

    const targets = new Set(['someleze mkhathini', 'jack sparrow']);
    const existingCases = JSON.parse(localStorage.getItem(KEYS.cases) || '[]');

    if (!Array.isArray(existingCases)) {
      localStorage.setItem(markerKey, 'complete');
      return;
    }

    const normalizeName = value =>
      String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

    const removed = existingCases.filter(item =>
      targets.has(normalizeName(item.personName))
    );

    const removedIds = new Set(removed.map(item => String(item.id)));

    if (removed.length) {
      localStorage.setItem(
        KEYS.cases,
        JSON.stringify(
          existingCases.filter(item =>
            !targets.has(normalizeName(item.personName))
          )
        )
      );

      for (const [key, matches] of [
        [KEYS.sightings, item => removedIds.has(String(item.caseId))],
        [
          KEYS.notifications,
          item => item.caseId != null && removedIds.has(String(item.caseId))
        ]
      ]) {
        const rows = JSON.parse(localStorage.getItem(key) || '[]');

        if (Array.isArray(rows)) {
          localStorage.setItem(
            key,
            JSON.stringify(rows.filter(item => !matches(item)))
          );
        }
      }
    }

    localStorage.setItem(markerKey, 'complete');
  } catch {
    // Storage may be disabled; this must never stop the application from loading.
  }
}

cleanupRequestedLocalReportsOnce();

function asPublicCase(item) {
  const canPublishContacts = item.publishContactDetails === true;

  // Never expose exact coordinates, creator identifiers, private circumstances,
  // or moderation notes from browser-local records through public alert responses.
  const {
    lastSeenLatitude: privateLatitude,
    lastSeenLongitude: privateLongitude,
    createdByUserId: privateCreatorId,
    createdByEmail: privateCreatorEmail,
    circumstances: privateCircumstances,
    moderationReason: privateModerationReason,
    ...publicFields
  } = item;

  return {
    ...publicFields,
    contactName: canPublishContacts ? (item.contactName || null) : null,
    contactPhone: canPublishContacts ? (item.contactPhone || null) : null,
    contactEmail: canPublishContacts ? (item.contactEmail || null) : null
  };
}

function allSightings() {
  return readStore(KEYS.sightings, []);
}

function sortNewest(items) {
  return [...items].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );
}

function pushLocalNotification(userId, caseId, title, message) {
  if (!userId) return;

  const items = readStore(KEYS.notifications, []);

  items.unshift({
    id: `local-notice-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    userId,
    caseId,
    title,
    message,
    isRead: false,
    createdAt: new Date().toISOString()
  });

  writeStore(KEYS.notifications, items);
}

function recordLocalAudit(
  action,
  entityType,
  entityId,
  notes = '',
  actorOverride = null,
  entityLabel = null
) {
  try {
    let actor = actorOverride;

    if (!actor) {
      actor = JSON.parse(
        localStorage.getItem('missing_person_alert_user_v3') || 'null'
      );
    }

    const auditKey = 'missing_person_alert_audit_logs_v3';
    const items = readStore(auditKey, []);

    items.unshift({
      id: `local-audit-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      actorUserId: actor?.id || 'anonymous',
      actorDisplayName:
        actor?.displayName ||
        actor?.email ||
        (actor?.id === 'anonymous' ? 'Anonymous visitor' : 'Unavailable account'),
      actorEmail: actor?.email || null,
      action,
      entityType,
      entityId: String(entityId ?? ''),
      entityLabel,
      notes,
      createdAt: new Date().toISOString()
    });

    writeStore(auditKey, items);
  } catch {
    // Audit recording must not prevent the primary user action in browser-local mode.
  }
}

async function request(path, options = {}, token = null) {
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  if (response.status === 204) return null;

  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof body === 'string'
        ? body
        : body?.message ||
          body?.title ||
          (body?.errors && Object.values(body.errors).flat().join(' ')) ||
          'The request could not be completed.';

    throw new Error(message);
  }

  return body;
}

export async function getAlerts() {
  if (!LOCAL_DATA_MODE) {
    return request('/api/cases/alerts');
  }

  // Public alerts must always pass the administrator/moderator approval gate.
  return sortNewest(
    allCases()
      .filter(c => c.reviewStatus === 'Approved' && c.caseStatus !== 'Closed')
      .map(asPublicCase)
  );
}

export async function getPublicSightings() {
  if (!LOCAL_DATA_MODE) {
    return request('/api/sightings/public');
  }

  const casesById = new Map(
    allCases().map(item => [String(item.id), item])
  );

  return sortNewest(
    allSightings()
      .filter(sighting => {
        const relatedCase = casesById.get(String(sighting.caseId));

        return (
          sighting.reviewStatus === 'Reviewed' &&
          relatedCase?.reviewStatus === 'Approved' &&
          relatedCase?.caseStatus === 'Active'
        );
      })
      .map(sighting => {
        const relatedCase = casesById.get(String(sighting.caseId));

        return {
          ...sighting,
          personName: relatedCase?.personName || 'Missing person',
          publicLatitude: sighting.publicLatitude ?? null,
          publicLongitude: sighting.publicLongitude ?? null
        };
      })
  );
}

export async function getCaseDetails(id, token) {
  if (!LOCAL_DATA_MODE) {
    return request(`/api/cases/${id}`, {}, token);
  }

  const item = allCases().find(c => String(c.id) === String(id));

  if (!item) {
    throw new Error('This case could not be found.');
  }

  let currentUser = null;

  try {
    currentUser = JSON.parse(
      localStorage.getItem('missing_person_alert_user_v3') || 'null'
    );
  } catch {
    // Treat malformed browser state as signed out.
  }

  const isOwner =
    currentUser &&
    (
      String(item.createdByUserId || '') === String(currentUser.id || '') ||
      (
        item.createdByEmail &&
        item.createdByEmail.toLowerCase() ===
          String(currentUser.email || '').toLowerCase()
      )
    );

  const canReview = ['Moderator', 'Administrator'].includes(currentUser?.role);

  if (item.reviewStatus !== 'Approved' || item.caseStatus === 'Closed') {
    if (!isOwner && !canReview) {
      throw new Error('This case is not available as a public alert.');
    }

    return item;
  }

  // Expose reporter details only when publication consent was recorded.
  return asPublicCase(item);
}

export async function registerAccount({ displayName, email, password }) {
  if (!LOCAL_DATA_MODE) {
    return request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ displayName, email, password })
    });
  }

  if (password.length < 8) {
    throw new Error('Use a password with at least 8 characters.');
  }

  const users = readStore(KEYS.users, []);

  if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error('An account with this email already exists.');
  }

  const user = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    displayName,
    email,
    role: 'Member'
  };

  users.push({ ...user, password });
  writeStore(KEYS.users, users);

  recordLocalAudit(
    'AccountRegistered',
    'User',
    user.id,
    'Member account registered.',
    user,
    email
  );

  return { token: `local-token-${user.id}`, user };
}

export async function loginAccount({ email, password }) {
  if (!LOCAL_DATA_MODE) {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  }

  // Browser-local mode only authenticates accounts registered in this browser.
  // It deliberately has no pre-created administrator or moderator credentials.
  // Use API mode with a securely configured server-side administrator account
  // for moderation and other privileged functions.
  const users = readStore(KEYS.users, []);
  const normalizedEmail = String(email || '').trim().toLowerCase();

  const user = users.find(candidate =>
    String(candidate.email || '').trim().toLowerCase() === normalizedEmail &&
    candidate.password === password
  );

  if (!user) {
    throw new Error('Incorrect password or email.');
  }

  const { password: ignored, ...safeUser } = user;

  recordLocalAudit(
    'UserSignedIn',
    'User',
    safeUser.id,
    'Successful sign-in.',
    safeUser,
    safeUser.email
  );

  return { token: `local-token-${safeUser.id}`, user: safeUser };
}

export async function createMissingPersonCase(data, token, user) {
  if (!data.photo || !data.photo.size) {
    throw new Error('A recent photograph is required to submit a missing-person report.');
  }

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(data.photo.type)) {
    throw new Error('The recent photograph must be a JPEG, PNG or WebP image.');
  }

  if (data.photo.size > 5 * 1024 * 1024) {
    throw new Error('The photograph must be 5 MB or smaller.');
  }

  if (!String(data.contactPhone || '').trim()) {
    throw new Error('Contact phone is required.');
  }

  if (!String(data.contactEmail || '').trim()) {
    throw new Error('Contact email is required.');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.contactEmail).trim())) {
    throw new Error('Enter a valid contact email address.');
  }

  if (
    data.lastSeenLatitude === null ||
    data.lastSeenLatitude === undefined ||
    data.lastSeenLatitude === '' ||
    data.lastSeenLongitude === null ||
    data.lastSeenLongitude === undefined ||
    data.lastSeenLongitude === ''
  ) {
    throw new Error('Select an approximate last-known location on the map.');
  }

  if (!data.lastSeenAt || Number.isNaN(new Date(data.lastSeenAt).getTime())) {
    throw new Error('Enter a valid last-seen date and time.');
  }

  if (new Date(data.lastSeenAt).getTime() > Date.now()) {
    throw new Error('Last-seen date and time cannot be in the future.');
  }

  if (!LOCAL_DATA_MODE) {
    const form = new FormData();

    Object.entries(data).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        form.append(key, value instanceof File ? value : String(value));
      }
    });

    return request('/api/cases', {
      method: 'POST',
      body: form
    }, token);
  }

  const cases = allCases();
  const nextId = Math.max(0, ...cases.map(c => Number(c.id) || 0)) + 1;

  const created = {
    id: nextId,
    caseReference: `MPA-${new Date().getFullYear()}-${String(nextId).padStart(3, '0')}`,
    personName: data.personName,
    ageAtDisappearance: Number(data.ageAtDisappearance),
    description: data.description,
    clothingDescription: data.clothingDescription || '',
    lastSeenAt: data.lastSeenAt,
    publicAreaName: data.publicAreaName,
    lastSeenLatitude: Number(data.lastSeenLatitude),
    lastSeenLongitude: Number(data.lastSeenLongitude),
    circumstances: String(data.circumstances || '').trim(),
    publicLatitude:
      data.lastSeenLatitude !== null &&
      data.lastSeenLatitude !== undefined &&
      data.lastSeenLatitude !== ''
        ? Math.round(Number(data.lastSeenLatitude) * 100) / 100
        : null,
    publicLongitude:
      data.lastSeenLongitude !== null &&
      data.lastSeenLongitude !== undefined &&
      data.lastSeenLongitude !== ''
        ? Math.round(Number(data.lastSeenLongitude) * 100) / 100
        : null,
    caseStatus: 'Active',
    reviewStatus: 'Pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdByUserId: user?.id || 'local-anonymous',
    createdByEmail: user?.email || '',
    photoName: data.photo?.name || null,
    contactName: data.contactName,
    contactPhone: data.contactPhone || '',
    contactEmail: data.contactEmail || '',
    publishContactDetails: data.publishContactDetails === true
  };

  cases.push(created);
  writeStore(KEYS.cases, cases);

  recordLocalAudit(
    'CaseSubmitted',
    'MissingPersonCase',
    created.id,
    'Report submitted for administrator review.',
    user,
    `${created.caseReference} — ${created.personName}`
  );

  return {
    id: created.id,
    caseReference: created.caseReference,
    reviewStatus: created.reviewStatus,
    message: 'Your report was saved for moderator review.'
  };
}

export async function updateMissingPersonCase(id, data, token, user) {
  if (
    data.photo?.size &&
    !['image/jpeg', 'image/png', 'image/webp'].includes(data.photo.type)
  ) {
    throw new Error('The recent photograph must be a JPEG, PNG or WebP image.');
  }

  if (data.photo?.size > 5 * 1024 * 1024) {
    throw new Error('The photograph must be 5 MB or smaller.');
  }

  if (data.confirmsRightToShare !== true) {
    throw new Error(
      'Please confirm that the updated information and photograph are accurate and that you are authorised to share them.'
    );
  }

  if (!String(data.contactPhone || '').trim()) {
    throw new Error('Contact phone is required.');
  }

  if (!String(data.contactEmail || '').trim()) {
    throw new Error('Contact email is required.');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.contactEmail).trim())) {
    throw new Error('Enter a valid contact email address.');
  }

  if (
    data.lastSeenLatitude === null ||
    data.lastSeenLatitude === undefined ||
    data.lastSeenLatitude === '' ||
    data.lastSeenLongitude === null ||
    data.lastSeenLongitude === undefined ||
    data.lastSeenLongitude === ''
  ) {
    throw new Error('Select an approximate last-known location on the map.');
  }

  if (!data.lastSeenAt || Number.isNaN(new Date(data.lastSeenAt).getTime())) {
    throw new Error('Enter a valid last-seen date and time.');
  }

  if (new Date(data.lastSeenAt).getTime() > Date.now()) {
    throw new Error('Last-seen date and time cannot be in the future.');
  }

  if (!LOCAL_DATA_MODE) {
    const form = new FormData();

    Object.entries(data).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        form.append(key, value instanceof File ? value : String(value));
      }
    });

    return request(`/api/cases/${id}`, {
      method: 'PUT',
      body: form
    }, token);
  }

  const cases = allCases();
  const existing = cases.find(c => String(c.id) === String(id));

  if (!existing) {
    throw new Error('Report not found.');
  }

  const isOwner =
    (user?.id && String(existing.createdByUserId || '') === String(user.id)) ||
    (
      existing.createdByEmail &&
      user?.email &&
      existing.createdByEmail.toLowerCase() === user.email.toLowerCase()
    );

  if (!isOwner) {
    throw new Error('Only the person who created this report can edit it.');
  }

  if (existing.caseStatus !== 'Active') {
    throw new Error('A report cannot be edited after the case has been marked found or closed.');
  }

  if (
    (!data.photo || !data.photo.size) &&
    !(existing.photoUrl || existing.photoStorageKey || existing.photoName)
  ) {
    throw new Error('A recent photograph is required. Upload one before resubmitting this report.');
  }

  const updated = {
    ...existing,
    personName: String(data.personName || '').trim(),
    ageAtDisappearance: Number(data.ageAtDisappearance),
    description: String(data.description || '').trim(),
    clothingDescription: String(data.clothingDescription || '').trim(),
    lastSeenAt: data.lastSeenAt,
    publicAreaName: String(data.publicAreaName || '').trim(),
    lastSeenLatitude: Number(data.lastSeenLatitude),
    lastSeenLongitude: Number(data.lastSeenLongitude),
    publicLatitude: Math.round(Number(data.lastSeenLatitude) * 100) / 100,
    publicLongitude: Math.round(Number(data.lastSeenLongitude) * 100) / 100,
    contactName: String(data.contactName || '').trim(),
    contactPhone: String(data.contactPhone || '').trim(),
    contactEmail: String(data.contactEmail || '').trim(),
    publishContactDetails: data.publishContactDetails === true,
    circumstances: String(data.circumstances || '').trim(),
    photoName: data.photo?.name || existing.photoName || null,
    reviewStatus: 'Pending',
    reviewedAt: null,
    reviewedByUserId: null,
    moderationReason: null,
    updatedAt: new Date().toISOString()
  };

  writeStore(
    KEYS.cases,
    cases.map(c => String(c.id) === String(id) ? updated : c)
  );

  recordLocalAudit(
    'CaseEditedAndResubmitted',
    'MissingPersonCase',
    updated.id,
    'Report owner edited the report and sent it back for administrator approval.',
    user,
    `${updated.caseReference} — ${updated.personName}`
  );

  const sightings = allSightings().map(sighting =>
    String(sighting.caseId) === String(id) &&
    ['Reviewed', 'Pending'].includes(sighting.reviewStatus)
      ? {
          ...sighting,
          reviewStatus: 'HiddenCaseEdited',
          hiddenAt: new Date().toISOString()
        }
      : sighting
  );

  writeStore(KEYS.sightings, sightings);

  pushLocalNotification(
    existing.createdByUserId,
    existing.id,
    'Report resubmitted for approval',
    'Your edited report has been sent to the administrator for review and is not currently public.'
  );

  return {
    id: updated.id,
    caseReference: updated.caseReference,
    reviewStatus: updated.reviewStatus,
    message: 'Your report was updated and sent back for administrator approval. It is no longer public until approved again.'
  };
}

export async function getMyCases(token, user) {
  if (!LOCAL_DATA_MODE) {
    return request('/api/cases/mine', {}, token);
  }

  return sortNewest(
    allCases().filter(c =>
      c.createdByUserId === user?.id ||
      (c.createdByEmail && c.createdByEmail === user?.email)
    )
  );
}

export async function getPendingCases(token) {
  if (!LOCAL_DATA_MODE) {
    return request('/api/admin/cases/pending', {}, token);
  }

  return sortNewest(allCases().filter(c => c.reviewStatus === 'Pending'));
}

export async function reviewCase(id, action, token, reason = '') {
  if (!LOCAL_DATA_MODE) {
    return request(`/api/admin/cases/${id}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    }, token);
  }

  const original = allCases();
  const prior = original.find(c => String(c.id) === String(id));

  const cases = original.map(c =>
    String(c.id) === String(id)
      ? {
          ...c,
          reviewStatus: action === 'approve' ? 'Approved' : 'Rejected',
          moderatedAt: new Date().toISOString(),
          moderationReason: reason
        }
      : c
  );

  writeStore(KEYS.cases, cases);

  const found = cases.find(c => String(c.id) === String(id));

  if (!found) {
    throw new Error('Case not found.');
  }

  recordLocalAudit(
    action === 'approve' ? 'CaseApproved' : 'CaseRejected',
    'MissingPersonCase',
    found.id,
    reason || (
      action === 'approve'
        ? 'Report approved for public alerts.'
        : 'Report rejected and kept private.'
    ),
    null,
    `${found.caseReference} — ${found.personName}`
  );

  const message = action === 'approve'
    ? 'Your report was approved by an application moderator.'
    : 'Your report was not approved for public sharing.';

  const title = action === 'approve' ? 'Report approved' : 'Report review update';
  const recipients = new Set(prior?.createdByUserId ? [prior.createdByUserId] : []);

  if (action === 'approve' && prior?.publicAreaName) {
    readStore(KEYS.subscriptions, [])
      .filter(sub => sub.areaName?.toLowerCase() === prior.publicAreaName.toLowerCase())
      .forEach(sub => recipients.add(sub.userId));
  }

  recipients.forEach(userId =>
    pushLocalNotification(userId, prior?.id, title, message)
  );

  return found;
}

export async function updateCaseStatus(id, status, token) {
  if (!LOCAL_DATA_MODE) {
    return request(`/api/admin/cases/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    }, token);
  }

  const original = allCases();
  const prior = original.find(c => String(c.id) === String(id));

  const cases = original.map(c =>
    String(c.id) === String(id)
      ? { ...c, caseStatus: status, updatedAt: new Date().toISOString() }
      : c
  );

  writeStore(KEYS.cases, cases);

  // When resolved or closed, hide related sighting pins but retain their records.
  if (['FoundSafe', 'FoundDeceased', 'Closed'].includes(status)) {
    const sightings = allSightings().map(sighting =>
      String(sighting.caseId) === String(id) &&
      ['Reviewed', 'Pending'].includes(sighting.reviewStatus)
        ? {
            ...sighting,
            reviewStatus: 'HiddenCaseResolved',
            hiddenAt: new Date().toISOString()
          }
        : sighting
    );

    writeStore(KEYS.sightings, sightings);
  }

  const found = cases.find(c => String(c.id) === String(id));

  if (found) {
    recordLocalAudit(
      'CaseStatusChanged',
      'MissingPersonCase',
      found.id,
      `${prior?.caseStatus || 'Unknown'} -> ${status}`,
      null,
      `${found.caseReference} — ${found.personName}`
    );
  }

  const recipients = new Set(prior?.createdByUserId ? [prior.createdByUserId] : []);

  if (prior?.publicAreaName) {
    readStore(KEYS.subscriptions, [])
      .filter(sub => sub.areaName?.toLowerCase() === prior.publicAreaName.toLowerCase())
      .forEach(sub => recipients.add(sub.userId));
  }

  const statusLabel = status === 'FoundSafe'
    ? 'Found Safe'
    : status === 'FoundDeceased'
      ? 'Found Deceased'
      : status;

  const message = `A moderator updated the case status to ${statusLabel}.`;

  recipients.forEach(userId =>
    pushLocalNotification(userId, prior?.id, 'Case status updated', message)
  );

  return found;
}

export async function correctCaseStatus(id, status, reason, token) {
  const cleanReason = String(reason || '').trim();

  if (cleanReason.length < 10) {
    throw new Error('Provide a correction reason of at least 10 characters.');
  }

  if (!['Active', 'FoundSafe', 'FoundDeceased'].includes(status)) {
    throw new Error('Choose a valid corrected case status.');
  }

  if (!LOCAL_DATA_MODE) {
    return request(`/api/admin/cases/${id}/correct-status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason: cleanReason })
    }, token);
  }

  const cases = allCases();
  const prior = cases.find(item => String(item.id) === String(id));

  if (!prior || prior.reviewStatus !== 'Approved') {
    throw new Error('Approved case not found.');
  }

  if (!['FoundSafe', 'FoundDeceased'].includes(prior.caseStatus)) {
    throw new Error('Only resolved cases can use this correction workflow.');
  }

  if (prior.caseStatus === status) {
    throw new Error('The case already has that status. Choose a different corrected status.');
  }

  const updated = {
    ...prior,
    caseStatus: status,
    updatedAt: new Date().toISOString()
  };

  writeStore(
    KEYS.cases,
    cases.map(item => String(item.id) === String(id) ? updated : item)
  );

  // Earlier sightings remain hidden after a correction.
  // A reopened case does not republish stale tips.
  const sightings = allSightings().map(sighting =>
    String(sighting.caseId) === String(id) &&
    ['Reviewed', 'Pending'].includes(sighting.reviewStatus)
      ? {
          ...sighting,
          reviewStatus: 'HiddenCaseResolved',
          hiddenAt: new Date().toISOString()
        }
      : sighting
  );

  writeStore(KEYS.sightings, sightings);

  recordLocalAudit(
    'CaseStatusCorrected',
    'MissingPersonCase',
    id,
    `${prior.caseStatus} -> ${status}. Reason: ${cleanReason}. Related sightings remain hidden pending fresh review.`,
    null,
    `${prior.caseReference} — ${prior.personName}`
  );

  const recipients = new Set(prior.createdByUserId ? [prior.createdByUserId] : []);

  if (prior.publicAreaName) {
    readStore(KEYS.subscriptions, [])
      .filter(sub => sub.areaName?.toLowerCase() === prior.publicAreaName.toLowerCase())
      .forEach(sub => recipients.add(sub.userId));
  }

  const label = status === 'Active'
    ? 'Active — person is still missing'
    : status === 'FoundSafe'
      ? 'Found Safe'
      : 'Found Deceased';

  recipients.forEach(userId =>
    pushLocalNotification(
      userId,
      prior.id,
      'Case status corrected by administrator',
      `An administrator corrected the status of case ${prior.caseReference} to ${label}.`
    )
  );

  return updated;
}

export async function submitSighting(data, token) {
  const caseId = Number(data.caseId);
  const description = String(data.description ?? '').trim();
  const publicAreaName = String(data.publicAreaName ?? '').trim();
  const seenAt = data.seenAt ? new Date(data.seenAt) : null;

  const latitude =
    data.sightingLatitude === null ||
    data.sightingLatitude === undefined ||
    data.sightingLatitude === ''
      ? null
      : Number(data.sightingLatitude);

  const longitude =
    data.sightingLongitude === null ||
    data.sightingLongitude === undefined ||
    data.sightingLongitude === ''
      ? null
      : Number(data.sightingLongitude);

  if (!Number.isInteger(caseId) || caseId < 1) {
    throw new Error('Select an active public alert before submitting a sighting.');
  }

  if (description.length < 10 || description.length > 2000) {
    throw new Error('Describe what you observed using between 10 and 2000 characters.');
  }

  if (publicAreaName.length < 2 || publicAreaName.length > 150) {
    throw new Error('Enter a sighting area between 2 and 150 characters.');
  }

  if (!seenAt || Number.isNaN(seenAt.getTime())) {
    throw new Error('Enter a valid sighting date and time.');
  }

  if (seenAt.getTime() > Date.now()) {
    throw new Error('Sighting date and time cannot be in the future.');
  }

  if (
    latitude === null ||
    longitude === null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error('Select an approximate sighting location on the map.');
  }

  // Send a consistent camelCase JSON payload with numeric values and ISO timestamp.
  const payload = {
    caseId,
    description,
    publicAreaName,
    seenAt: seenAt.toISOString(),
    sightingLatitude: latitude,
    sightingLongitude: longitude,
    isAnonymous: Boolean(data.isAnonymous),
    contactName: String(data.contactName ?? '').trim() || null,
    contactEmail: String(data.contactEmail ?? '').trim() || null
  };

  if (!LOCAL_DATA_MODE) {
    return request('/api/sightings', {
      method: 'POST',
      body: JSON.stringify(payload)
    }, token);
  }

  const relatedCase = allCases().find(c =>
    String(c.id) === String(payload.caseId) &&
    c.reviewStatus === 'Approved' &&
    c.caseStatus === 'Active'
  );

  if (!relatedCase) {
    throw new Error('Select an active, administrator-approved alert.');
  }

  const sightings = allSightings();

  const item = {
    id: Math.max(0, ...sightings.map(s => Number(s.id) || 0)) + 1,
    caseId: Number(payload.caseId),
    caseReference: relatedCase.caseReference || '',
    personName: relatedCase.personName || 'Missing person',
    description: payload.description,
    publicAreaName: payload.publicAreaName,
    publicLatitude:
      payload.sightingLatitude !== null &&
      payload.sightingLatitude !== undefined &&
      payload.sightingLatitude !== ''
        ? Math.round(Number(payload.sightingLatitude) * 100) / 100
        : null,
    publicLongitude:
      payload.sightingLongitude !== null &&
      payload.sightingLongitude !== undefined &&
      payload.sightingLongitude !== ''
        ? Math.round(Number(payload.sightingLongitude) * 100) / 100
        : null,
    seenAt: payload.seenAt,
    isAnonymous: Boolean(payload.isAnonymous),
    contactName: payload.isAnonymous ? '' : payload.contactName || '',
    contactEmail: payload.isAnonymous ? '' : payload.contactEmail || '',
    reviewStatus: 'Pending',
    createdAt: new Date().toISOString()
  };

  sightings.push(item);
  writeStore(KEYS.sightings, sightings);

  recordLocalAudit(
    'SightingSubmitted',
    'Sighting',
    item.id,
    'Possible sighting submitted for review; contact information is excluded from the audit record.',
    null,
    `${item.caseReference} — ${item.publicAreaName}`
  );

  return {
    id: item.id,
    message: 'Your sighting was saved for review.'
  };
}

export async function getPendingSightings(token) {
  if (!LOCAL_DATA_MODE) {
    return request('/api/admin/sightings/pending', {}, token);
  }

  return sortNewest(
    allSightings().filter(s => s.reviewStatus === 'Pending')
  );
}

export async function reviewSighting(id, action, token) {
  if (!LOCAL_DATA_MODE) {
    return request(`/api/admin/sightings/${id}/${action}`, {
      method: 'POST'
    }, token);
  }

  const target = allSightings().find(s => String(s.id) === String(id));

  if (!target) {
    throw new Error('Sighting not found.');
  }

  const relatedCase = allCases().find(c => String(c.id) === String(target.caseId));

  if (
    action === 'approve' &&
    (
      relatedCase?.reviewStatus !== 'Approved' ||
      relatedCase?.caseStatus !== 'Active'
    )
  ) {
    throw new Error(
      'This sighting cannot be published because the related case is no longer an active missing-person alert.'
    );
  }

  const sightings = allSightings().map(s =>
    String(s.id) === String(id)
      ? { ...s, reviewStatus: action === 'approve' ? 'Reviewed' : 'Rejected' }
      : s
  );

  writeStore(KEYS.sightings, sightings);

  const reviewed = sightings.find(s => String(s.id) === String(id));

  recordLocalAudit(
    action === 'approve' ? 'SightingReviewed' : 'SightingRejected',
    'Sighting',
    id,
    action === 'approve'
      ? 'Sighting approved for public possible-sighting display.'
      : 'Sighting rejected and kept private.',
    null,
    `${relatedCase?.caseReference || `Case #${target.caseId}`} — ${target.publicAreaName}`
  );

  return reviewed;
}

export async function getAuditTrail(
  token,
  { skip = 0, take = 25, search = '', action = 'All' } = {}
) {
  const params = new URLSearchParams({
    skip: String(skip),
    take: String(take)
  });

  if (search.trim()) {
    params.set('search', search.trim());
  }

  if (action && action !== 'All') {
    params.set('action', action);
  }

  if (!LOCAL_DATA_MODE) {
    return request(`/api/admin/audit-trail?${params.toString()}`, {}, token);
  }

  let currentUser = null;

  try {
    currentUser = JSON.parse(
      localStorage.getItem('missing_person_alert_user_v3') || 'null'
    );
  } catch {
    // Treat malformed local state as signed out.
  }

  if (currentUser?.role !== 'Administrator') {
    throw new Error('Only an administrator can view the audit trail.');
  }

  const localUsers = readStore(KEYS.users, []);

  const stored = readStore('missing_person_alert_audit_logs_v3', [])
    .map(row => {
      const actor = localUsers.find(
        candidate => String(candidate.id) === String(row.actorUserId)
      ) || null;

      return {
        ...row,
        actorDisplayName:
          row.actorDisplayName || actor?.displayName || 'Unavailable account',
        actorEmail: row.actorEmail || actor?.email || null
      };
    })
    .sort((a, b) =>
      new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );

  const needle = search.trim().toLowerCase();

  const filtered = stored.filter(row => {
    const actionMatches = !action || action === 'All' || row.action === action;

    const searchText = [
      row.actorDisplayName,
      row.actorEmail,
      row.action,
      row.entityType,
      row.entityId,
      row.entityLabel,
      row.notes
    ].join(' ').toLowerCase();

    return actionMatches && (!needle || searchText.includes(needle));
  });

  return {
    items: filtered.slice(skip, skip + take),
    total: filtered.length,
    skip,
    take
  };
}

export async function getSubscriptions(token, user) {
  if (!LOCAL_DATA_MODE) {
    return request('/api/subscriptions', {}, token);
  }

  return readStore(KEYS.subscriptions, []).filter(
    item => item.userId === user?.id
  );
}

export async function createAreaSubscription(areaName, token, user) {
  if (!LOCAL_DATA_MODE) {
    return request('/api/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ areaName })
    }, token);
  }

  if (!user?.id) {
    throw new Error('Sign in before subscribing to an area.');
  }

  const items = readStore(KEYS.subscriptions, []);

  const prior = items.find(item =>
    item.userId === user.id &&
    item.areaName.toLowerCase() === areaName.toLowerCase()
  );

  if (prior) return prior;

  const item = {
    id: `local-sub-${Date.now()}`,
    userId: user.id,
    areaName,
    createdAt: new Date().toISOString()
  };

  items.push(item);
  writeStore(KEYS.subscriptions, items);

  recordLocalAudit(
    'AreaSubscriptionCreated',
    'AreaSubscription',
    item.id,
    `Subscribed to area: ${areaName}.`,
    user,
    areaName
  );

  return item;
}

export async function deleteAreaSubscription(id, token) {
  if (!LOCAL_DATA_MODE) {
    return request(`/api/subscriptions/${id}`, {
      method: 'DELETE'
    }, token);
  }

  const subscriptions = readStore(KEYS.subscriptions, []);
  const existing = subscriptions.find(item => String(item.id) === String(id));

  writeStore(
    KEYS.subscriptions,
    subscriptions.filter(item => String(item.id) !== String(id))
  );

  if (existing) {
    recordLocalAudit(
      'AreaSubscriptionDeleted',
      'AreaSubscription',
      id,
      `Unsubscribed from area: ${existing.areaName}.`,
      null,
      existing.areaName
    );
  }

  return null;
}

export async function getNotifications(token) {
  if (!LOCAL_DATA_MODE) {
    return request('/api/notifications', {}, token);
  }

  const user = JSON.parse(
    localStorage.getItem('missing_person_alert_user_v3') || 'null'
  );

  const items = readStore(KEYS.notifications, []);
  return items.filter(n => n.userId === user?.id);
}

export async function markNotificationRead(id, token) {
  if (!LOCAL_DATA_MODE) {
    return request(`/api/notifications/${id}/read`, {
      method: 'POST'
    }, token);
  }

  const items = readStore(KEYS.notifications, []).map(n =>
    n.id === id ? { ...n, isRead: true } : n
  );

  writeStore(KEYS.notifications, items);
  return null;
}