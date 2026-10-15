import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowDownRight, ArrowRight, Bell, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardList,
  CircleHelp, Clock3, FileText, Filter, HeartHandshake, Home, Info, LogIn, LogOut, Pencil,
  Mail, MapPin, Menu, Phone, PlusCircle, Search, ShieldCheck, Siren, User, UserRoundSearch,
  Users, X
} from 'lucide-react';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import {
  createMissingPersonCase, updateMissingPersonCase, getAlerts, getMyCases, getPendingCases, getPendingSightings, getPublicSightings,
  loginAccount, getNotifications, markNotificationRead, registerAccount,
  resolveMediaUrl, reviewCase, reviewSighting, submitSighting, updateCaseStatus, correctCaseStatus,
  getSubscriptions, createAreaSubscription, deleteAreaSubscription, getAuditTrail
} from './api.js';

const USER_KEY = 'missing_person_alert_user_v3';
const TOKEN_KEY = 'missing_person_alert_token_v3';

// When the app is switched from browser-local mode to the ASP.NET Core API,
// tokens created by local mode are not valid API JWTs. Clear that stale session
// before React reads the signed-in user so protected endpoints do not repeatedly
// fail with 401/403 errors for subscriptions and the administrator review queue.
function clearIncompatibleLocalSession() {
  try {
    const localModeEnabled = import.meta.env.VITE_USE_LOCAL_DATA === 'true';
    const storedToken = localStorage.getItem(TOKEN_KEY) || '';
    if (!localModeEnabled && storedToken.startsWith('local-token-')) {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(TOKEN_KEY);
      return true;
    }
  } catch {
    // If browser storage is unavailable, allow the app to load signed out.
  }
  return false;
}
const clearedIncompatibleLocalSession = clearIncompatibleLocalSession();

const navItems = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'alerts', label: 'Missing people', icon: UserRoundSearch },
  { id: 'report', label: 'Report a person', icon: PlusCircle },
  { id: 'sighting', label: 'Share a sighting', icon: MapPin }
];

function readUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}
function readToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
function localDateTimeValue(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
// One search request is made only when a user submits a place name without dropping a map pin.
// This is a lookup, not live autocomplete. The manual map-pin option remains available as a fallback.
async function geocodeSouthAfricanPlace(placeName) {
  const place = String(placeName || '').trim();
  if (!place) return null;
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: `${place}, South Africa`,
    countrycodes: 'za',
    limit: '1'
  });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return null;
    const results = await response.json();
    const result = Array.isArray(results) ? results[0] : null;
    if (!result) return null;
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}
// Convert a manually selected map pin into a useful suburb/town label.
// If reverse geocoding is unavailable, the caller still keeps the selected coordinates.
async function reverseGeocodeSouthAfricanPlace({ lat, lng }) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lng),
    // A more detailed result helps Nominatim return the suburb/locality hierarchy.
    zoom: '18',
    addressdetails: '1'
  });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return null;
    const result = await response.json();
    const address = result?.address || {};
    const cleanLabel = value => {
      const text = String(value || '').trim();
      // Do not show ward identifiers, state/province, country or postcodes as an area.
      if (!text || /\bward\b/i.test(text)) return null;
      if ((address.state && text.toLowerCase() === String(address.state).trim().toLowerCase())
        || (address.country && text.toLowerCase() === String(address.country).trim().toLowerCase())) return null;
      if (/^(KwaZulu-Natal|South Africa)$/i.test(text) || /^\d{4,}$/.test(text)) return null;
      return text;
    };
    const unique = values => values.map(cleanLabel).filter(Boolean)
      .filter((value, index, all) => all.findIndex(other => other.toLowerCase() === value.toLowerCase()) === index);
    const displayParts = unique(String(result?.display_name || '').split(','))
      .filter(part => !/\b(road|rd|street|st|avenue|ave|drive|dr|lane|ln|highway|hwy|ward)\b/i.test(part))
      .filter(part => !/^\d/.test(part));

    // Prefer an actual suburb/neighbourhood first. If a structured address lacks a
    // suburb, use the non-street locality components of display_name as a fallback.
    // In eThekwini, this favours labels like "Ashley, Pinetown" and skips
    // administrative labels such as "eThekwini Ward 31".
    const structuredSuburb = unique([
      address.suburb,
      address.neighbourhood,
      address.quarter,
      address.residential,
      address.hamlet
    ])[0];
    const notSuburb = value => !structuredSuburb || value.toLowerCase() !== structuredSuburb.toLowerCase();
    const nearbyLocalities = unique([
      address.city_district,
      address.town,
      address.city,
      address.village
    ]).filter(notSuburb);
    const administrativeLocalities = unique([address.municipality, address.county]).filter(notSuburb);
    const displaySuburb = displayParts.find(value =>
      !nearbyLocalities.some(wider => wider.toLowerCase() === value.toLowerCase())
      && !administrativeLocalities.some(wider => wider.toLowerCase() === value.toLowerCase())
    );
    const suburb = structuredSuburb || displaySuburb;
    const mainLocality = nearbyLocalities.find(value => !suburb || value.toLowerCase() !== suburb.toLowerCase())
      || displayParts.find(value => !suburb || value.toLowerCase() !== suburb.toLowerCase())
      || administrativeLocalities.find(value => !suburb || value.toLowerCase() !== suburb.toLowerCase());
    const parts = unique([suburb, mainLocality]);
    if (parts.length) return parts.join(', ');

    // A named place feature can be useful when structured address fields are incomplete.
    return cleanLabel(result?.name) || null;
  } catch {
    return null;
  }
}
function dateLabel(value) {
  if (!value) return 'Date not provided';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date not provided' : new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function caseStatusLabel(status) {
  return status === 'FoundSafe' ? 'Found safe' : status === 'FoundDeceased' ? 'Found deceased' : status === 'Closed' ? 'Closed' : 'Active';
}
const AUDIT_ACTION_LABELS = {
  CaseSubmitted: 'Report submitted',
  CaseEditedAndResubmitted: 'Report edited and resubmitted',
  CaseApproved: 'Report approved',
  CaseRejected: 'Report rejected',
  CaseStatusChanged: 'Case status changed',
  CaseStatusCorrected: 'Case status corrected',
  SightingSubmitted: 'Possible sighting submitted',
  SightingReviewed: 'Possible sighting approved',
  SightingRejected: 'Possible sighting rejected',
  AccountRegistered: 'Account registered',
  UserSignedIn: 'User signed in',
  AreaSubscriptionCreated: 'Area subscription created',
  AreaSubscriptionDeleted: 'Area subscription removed'
};
function auditActionLabel(action) { return AUDIT_ACTION_LABELS[action] || String(action || 'Activity').replace(/([a-z])([A-Z])/g, '$1 $2'); }
function StatusPill({ status }) {
  const label = status === 'FoundSafe' ? 'Found safe' : status === 'FoundDeceased' ? 'Found deceased' : status === 'Pending' ? 'Awaiting review' : status === 'Rejected' ? 'Rejected' : status === 'Approved' ? 'Moderator-approved' : status === 'Active' ? 'Active alert' : status || 'Unknown';
  const className = status === 'FoundSafe' ? 'pill found' : status === 'FoundDeceased' ? 'pill deceased' : status === 'Pending' ? 'pill pending' : status === 'Rejected' ? 'pill rejected' : status === 'Approved' ? 'pill approved' : 'pill active';
  return <span className={className}>{label}</span>;
}
function AlertCard({ item, onOpen }) {
  return <article className="alert-card">
    <div className="alert-card-top">
      <div className="person-avatar"><UserRoundSearch size={25} /></div>
      <StatusPill status={item.caseStatus} />
    </div>
    <div className="reference">{item.caseReference || 'Case'}</div>
    <h3>{item.personName || 'Name not provided'}</h3>
    <p className="muted">{item.ageAtDisappearance ? `${item.ageAtDisappearance} years old` : 'Age not confirmed'} · {item.publicAreaName || 'Area not provided'}</p>
    <p className="card-description">{item.description || 'Please open the alert for further information.'}</p>
    <div className="card-meta"><Clock3 size={15} /> Last seen: {dateLabel(item.lastSeenAt)}</div>
    <div className="card-footer">
      <span><ShieldCheck size={15} /> Application review status shown</span>
      <button className="text-button" onClick={() => onOpen(item)}>View alert <ArrowRight size={15} /></button>
    </div>
  </article>;
}
function AlertsMap({ alerts, sightings = [], onOpen }) {
  const points = alerts.filter(a => Number.isFinite(Number(a.publicLatitude)) && Number.isFinite(Number(a.publicLongitude)) && a.publicLatitude !== null && a.publicLongitude !== null);
  const activeCaseIds = new Set(alerts.filter(item => item.caseStatus === 'Active').map(item => String(item.id)));
  const sightingPoints = sightings.filter(s => activeCaseIds.has(String(s.caseId)) && Number.isFinite(Number(s.publicLatitude)) && Number.isFinite(Number(s.publicLongitude)) && s.publicLatitude !== null && s.publicLongitude !== null);
  const alertsById = new Map(alerts.map(item => [String(item.id), item]));
  return <div className="map-wrap">
    <MapContainer center={[-29.82, 30.65]} zoom={8} scrollWheelZoom={false} className="map-canvas">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {points.map(item => <CircleMarker key={`case-${item.id}`} center={[item.publicLatitude, item.publicLongitude]} radius={9} pathOptions={{ color: item.caseStatus === 'FoundSafe' ? '#18846b' : item.caseStatus === 'FoundDeceased' ? '#454b54' : '#d45a42', fillColor: item.caseStatus === 'FoundSafe' ? '#20a282' : item.caseStatus === 'FoundDeceased' ? '#626b76' : '#f2775f', fillOpacity: 0.85 }}>
        <Popup><div className="map-popup"><strong>{item.personName}</strong><br />{item.publicAreaName}<br /><span>{item.caseStatus === 'FoundSafe' ? 'Found safe' : item.caseStatus === 'FoundDeceased' ? 'Found deceased' : 'Approved missing-person alert'}</span><br /><button className="text-button" onClick={() => onOpen(item)}>View alert</button></div></Popup>
      </CircleMarker>)}
      {sightingPoints.map(item => <CircleMarker key={`sighting-${item.id}`} center={[item.publicLatitude, item.publicLongitude]} radius={7} pathOptions={{ color: '#8757a5', fillColor: '#a77bc4', fillOpacity: 0.95 }}>
        <Popup><div className="map-popup"><strong>Possible sighting</strong><br /><span>{item.personName} · {item.caseReference}</span><br />{item.publicAreaName}<p>{item.description}</p><small>{dateLabel(item.seenAt)} · Moderator-reviewed, not confirmed</small><br />{alertsById.get(String(item.caseId)) && <button className="text-button" onClick={() => onOpen(alertsById.get(String(item.caseId)))}>View related alert</button>}</div></Popup>
      </CircleMarker>)}
    </MapContainer>
    <div className="map-note"><Info size={14} /> Map markers are approximate and may not show the person's exact last-known location.</div>
  </div>;
}
function MapPickEvents({ onPick }) {
  useMapEvents({ click(event) { onPick({ lat: Number(event.latlng.lat.toFixed(6)), lng: Number(event.latlng.lng.toFixed(6)) }); } });
  return null;
}
function MapRecenter({ value }) {
  const map = useMap();
  useEffect(() => {
    if (value && Number.isFinite(Number(value.lat)) && Number.isFinite(Number(value.lng))) {
      map.setView([Number(value.lat), Number(value.lng)], Math.max(map.getZoom(), 12), { animate: false });
    }
  }, [map, value?.lat, value?.lng]);
  return null;
}
function LocationPicker({ value, onChange, statusMessage = '', latitudeName = 'lastSeenLatitude', longitudeName = 'lastSeenLongitude' }) {
  return <div className="location-picker">
    <MapContainer center={value ? [value.lat, value.lng] : [-29.82, 30.65]} zoom={value ? 12 : 7} scrollWheelZoom={false} className="location-picker-map">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapPickEvents onPick={onChange} />
      <MapRecenter value={value} />
      {value && <CircleMarker center={[value.lat, value.lng]} radius={8} pathOptions={{ color: '#177d7b', fillColor: '#2ba99b', fillOpacity: 0.9 }} />}
    </MapContainer>
    <div className="location-picker-foot"><MapPin size={15} /><span>{value ? `Selected: ${value.label || 'map location'} · ${value.lat.toFixed(4)}, ${value.lng.toFixed(4)}` : 'Click the map to select a location. The area field will be updated automatically.'}</span>{value && <button type="button" className="text-button" onClick={() => onChange(null)}>Clear</button>}</div>
    {statusMessage && <p className="location-picker-status" role="status">{statusMessage}</p>}
    <input type="hidden" name={latitudeName} value={value?.lat ?? ''} />
    <input type="hidden" name={longitudeName} value={value?.lng ?? ''} />
  </div>;
}
function Field({ label, required, hint, children }) {
  return <label className="field"><span className="field-label">{label}{required && <b className="required"> *</b>}</span>{children}{hint && <small className="field-hint">{hint}</small>}</label>;
}
// Maps are interactive controls, not labelable inputs; keep them outside a wrapping <label>.
function FieldGroup({ label, required, hint, children }) {
  return <div className="field"><span className="field-label">{label}{required && <b className="required"> *</b>}</span>{children}{hint && <small className="field-hint">{hint}</small>}</div>;
}
function EmptyState({ title, text, icon: Icon = CircleHelp }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={24} /></span><h3>{title}</h3><p>{text}</p></div>;
}

export default function App() {
  const [page, setPage] = useState('home');
  const [adminTab, setAdminTab] = useState('review');
  const [auditEntries, setAuditEntries] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditSkip, setAuditSkip] = useState(0);
  const [auditSearchInput, setAuditSearchInput] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditAction, setAuditAction] = useState('All');
  const [auditLoading, setAuditLoading] = useState(false);
  const auditTake = 25;
  const [alerts, setAlerts] = useState([]);
  const [publicSightings, setPublicSightings] = useState([]);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [user, setUser] = useState(readUser);
  const [token, setToken] = useState(readToken);
  const [pendingCases, setPendingCases] = useState([]);
  const [pendingSightings, setPendingSightings] = useState([]);
  const [myCases, setMyCases] = useState([]);
  const [editingCase, setEditingCase] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [subscriptionArea, setSubscriptionArea] = useState('');
  const [pickedLocation, setPickedLocation] = useState(null);
  const [pickedSightingLocation, setPickedSightingLocation] = useState(null);
  const [reportAreaName, setReportAreaName] = useState('');
  const [sightingAreaName, setSightingAreaName] = useState('');
  const [reportLocationFeedback, setReportLocationFeedback] = useState('');
  const [sightingLocationFeedback, setSightingLocationFeedback] = useState('');
  const reportMapPickSequence = useRef(0);
  const sightingMapPickSequence = useRef(0);
  const [sightingCaseId, setSightingCaseId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(clearedIncompatibleLocalSession
    ? 'Your previous browser-local session was cleared because the application is now connected to the API. Please sign in again.'
    : '');
  const [search, setSearch] = useState('');
  const [areaFilter, setAreaFilter] = useState('All areas');
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const maxDateTime = localDateTimeValue();

  const refreshAlerts = useCallback(async () => {
    try {
      const data = await getAlerts();
      setAlerts(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(`Could not load alerts. ${e.message}`);
    } finally { setLoading(false); }
  }, []);

  const refreshPublicSightings = useCallback(async () => {
    try {
      const data = await getPublicSightings();
      setPublicSightings(Array.isArray(data) ? data : []);
    } catch (e) { setError(`Could not load reviewed sightings. ${e.message}`); }
  }, []);

  const refreshAdmin = useCallback(async () => {
    if (!token || !['Moderator', 'Administrator'].includes(user?.role)) return;
    try {
      const [cases, sightings] = await Promise.all([getPendingCases(token), getPendingSightings(token)]);
      setPendingCases(cases || []);
      setPendingSightings(sightings || []);
    } catch (e) { setError(`Could not load moderator queue. ${e.message}`); }
  }, [token, user]);

  const refreshAuditTrail = useCallback(async () => {
    if (!token || user?.role !== 'Administrator') { setAuditEntries([]); setAuditTotal(0); return; }
    setAuditLoading(true);
    try {
      const result = await getAuditTrail(token, { skip: auditSkip, take: auditTake, search: auditSearch, action: auditAction });
      setAuditEntries(Array.isArray(result?.items) ? result.items : []);
      setAuditTotal(Number(result?.total) || 0);
    } catch (e) { setError(`Could not load audit trail. ${e.message}`); }
    finally { setAuditLoading(false); }
  }, [token, user?.role, auditSkip, auditTake, auditSearch, auditAction]);

  const refreshMine = useCallback(async () => {
    if (!token || !user) return;
    try { setMyCases(await getMyCases(token, user) || []); }
    catch (e) { setError(`Could not load your reports. ${e.message}`); }
  }, [token, user]);

  const refreshNotifications = useCallback(async () => {
    if (!token || !user) { setNotifications([]); return; }
    try { setNotifications(await getNotifications(token) || []); }
    catch (e) { setError(`Could not load notifications. ${e.message}`); }
  }, [token, user]);

  const refreshSubscriptions = useCallback(async () => {
    if (!token || !user) { setSubscriptions([]); return; }
    try { setSubscriptions(await getSubscriptions(token, user) || []); }
    catch (e) { setError(`Could not load area subscriptions. ${e.message}`); }
  }, [token, user]);

  useEffect(() => { refreshAlerts(); refreshPublicSightings(); }, [refreshAlerts, refreshPublicSightings]);
  useEffect(() => { refreshAdmin(); refreshMine(); refreshNotifications(); refreshSubscriptions(); }, [refreshAdmin, refreshMine, refreshNotifications, refreshSubscriptions]);
  useEffect(() => {
    if (page === 'admin' && adminTab === 'audit' && user?.role === 'Administrator') refreshAuditTrail();
  }, [page, adminTab, refreshAuditTrail, user?.role]);
  useEffect(() => { if (user?.role !== 'Administrator' && adminTab !== 'review') setAdminTab('review'); }, [user?.role, adminTab]);
  useEffect(() => {
    const updatePublicData = () => {
      if (document.hidden) return;
      refreshAlerts();
      refreshPublicSightings();
      if (['Moderator', 'Administrator'].includes(user?.role)) refreshAdmin();
    };
    const timer = window.setInterval(updatePublicData, 15000);
    window.addEventListener('storage', updatePublicData);
    return () => { window.clearInterval(timer); window.removeEventListener('storage', updatePublicData); };
  }, [refreshAlerts, refreshPublicSightings, refreshAdmin, user?.role]);
  // Keep an open detail view in sync when another admin updates the case status.
  // This is important so a Found Safe update also hides the Possible sightings section immediately.
  useEffect(() => {
    if (!selectedAlert) return;
    const latest = alerts.find(item => String(item.id) === String(selectedAlert.id));
    if (!latest) return;
    const hasRelevantChange = latest.caseStatus !== selectedAlert.caseStatus
      || latest.reviewStatus !== selectedAlert.reviewStatus
      || latest.personName !== selectedAlert.personName
      || latest.publicAreaName !== selectedAlert.publicAreaName;
    if (hasRelevantChange) setSelectedAlert(latest);
  }, [alerts, selectedAlert]);

  useEffect(() => {
    const reportId = new URLSearchParams(window.location.search).get('report');
    if (!reportId || loading) return;
    const matchingAlert = alerts.find(item => String(item.id) === String(reportId) && item.reviewStatus === 'Approved');
    if (matchingAlert) { setSelectedAlert(matchingAlert); setPage('detail'); }
    else {
      const address = new URL(window.location.href);
      address.searchParams.delete('report');
      window.history.replaceState({}, '', `${address.pathname}${address.search}${address.hash}`);
      setError('That report is not available as a public alert. It may still be awaiting administrator approval or may have been closed.');
    }
  }, [alerts, loading]);

  const activeAlerts = useMemo(() => alerts.filter(a => a.caseStatus !== 'Closed'), [alerts]);
  const areas = useMemo(() => ['All areas', ...new Set(activeAlerts.map(a => a.publicAreaName).filter(Boolean))], [activeAlerts]);
  const filteredAlerts = useMemo(() => activeAlerts.filter(a => {
    const query = search.trim().toLowerCase();
    const matchSearch = !query || [a.personName, a.caseReference, a.publicAreaName, a.description].some(v => String(v || '').toLowerCase().includes(query));
    const matchArea = areaFilter === 'All areas' || a.publicAreaName === areaFilter;
    return matchSearch && matchArea;
  }), [activeAlerts, search, areaFilter]);
  const visibleSightings = useMemo(() => publicSightings.filter(s => filteredAlerts.some(a => String(a.id) === String(s.caseId) && a.caseStatus === 'Active')), [publicSightings, filteredAlerts]);

  function navigate(next) {
    setEditingCase(null);
    if (next === 'report') {
      setPickedLocation(null);
      setReportAreaName('');
      setReportLocationFeedback('');
      reportMapPickSequence.current += 1;
    }
    if (next === 'sighting') {
      setPickedSightingLocation(null);
      setSightingAreaName('');
      setSightingLocationFeedback('');
      sightingMapPickSequence.current += 1;
      setSightingCaseId(page === 'detail' && selectedAlert?.caseStatus === 'Active' ? String(selectedAlert.id) : '');
    }
    if (next !== 'detail') {
      const address = new URL(window.location.href);
      address.searchParams.delete('report');
      window.history.replaceState({}, '', `${address.pathname}${address.search}${address.hash}`);
    }
    setPage(next); setSelectedAlert(null); setError(''); setSuccess(''); setShowMobileNav(false); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function openAlert(item) {
    if (!item || item.reviewStatus !== 'Approved') { setError('This report is not approved for public viewing.'); return; }
    const address = new URL(window.location.href);
    address.searchParams.set('report', String(item.id));
    window.history.pushState({}, '', `${address.pathname}${address.search}${address.hash}`);
    // This view is public, even if opened from the reporter's own submissions. Never expose contacts without explicit consent.
    const publicView = item.publishContactDetails === true
      ? item
      : { ...item, contactName: null, contactPhone: null, contactEmail: null };
    setSelectedAlert(publicView); setPage('detail'); setError(''); setSuccess(''); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function startEditingCase(item) {
    if (!user || !token) { setError('Sign in with the account that created this report to edit it.'); return; }
    if (item.caseStatus !== 'Active') { setError('This report cannot be edited after the case has been marked found or closed.'); return; }
    const latitude = item.lastSeenLatitude ?? item.publicLatitude ?? null;
    const longitude = item.lastSeenLongitude ?? item.publicLongitude ?? null;
    setEditingCase(item);
    setPickedLocation(latitude !== null && longitude !== null ? { lat: Number(latitude), lng: Number(longitude), label: item.publicAreaName || 'Saved map location' } : null);
    setReportAreaName(item.publicAreaName || '');
    setReportLocationFeedback(latitude !== null && longitude !== null ? 'Saved location loaded. You can select a new point on the map.' : 'Select the approximate location on the map before resubmitting.');
    reportMapPickSequence.current += 1;
    setPage('report'); setSelectedAlert(null); setError(''); setSuccess(''); setShowMobileNav(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function signOut() {
    localStorage.removeItem(USER_KEY); localStorage.removeItem(TOKEN_KEY);
    setUser(null); setToken(''); setMyCases([]); setNotifications([]); setSubscriptions([]); setPendingCases([]); setPendingSightings([]); setSuccess('You have signed out.'); navigate('home');
  }
  function shareSelectedAlertOnWhatsApp() {
    if (!selectedAlert || selectedAlert.reviewStatus !== 'Approved') { setError('Only administrator-approved reports can be shared.'); return; }
    const reportUrl = new URL(window.location.href);
    reportUrl.searchParams.set('report', String(selectedAlert.id));
    const statusLabel = selectedAlert.caseStatus === 'FoundSafe' ? 'Found safe' : selectedAlert.caseStatus === 'FoundDeceased' ? 'Found deceased' : selectedAlert.caseStatus === 'Closed' ? 'Closed' : 'Active alert';
    const heading = ['FoundSafe', 'FoundDeceased', 'Closed'].includes(selectedAlert.caseStatus) ? 'MISSING PERSON CASE STATUS UPDATE' : 'MISSING PERSON ALERT';
    const reporterContact = [
      selectedAlert.contactName ? `Reporter: ${selectedAlert.contactName}` : '',
      selectedAlert.contactPhone ? `Contact phone: ${selectedAlert.contactPhone}` : '',
      selectedAlert.contactEmail ? `Contact email: ${selectedAlert.contactEmail}` : ''
    ].filter(Boolean).join('\n');
    const text = `${heading}\n${selectedAlert.personName} (${selectedAlert.caseReference})\nArea: ${selectedAlert.publicAreaName}\nStatus: ${statusLabel}${reporterContact ? `\n\n${reporterContact}` : ''}\n\nView this specific report: ${reportUrl.toString()}\nPlease share responsibly and send reliable information to the appropriate authorities.`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }
  async function handleAuth(event) {
    event.preventDefault(); setError(''); setSuccess(''); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = authMode === 'register'
        ? await registerAccount({ displayName: form.get('displayName'), email: form.get('email'), password: form.get('password') })
        : await loginAccount({ email: form.get('email'), password: form.get('password') });
      const role = result.user.role || (result.user.roles?.includes('Administrator') ? 'Administrator' : result.user.roles?.includes('Moderator') ? 'Moderator' : result.user.roles?.includes('Reporter') ? 'Reporter' : 'Member');
      const signedInUser = { ...result.user, role };
      localStorage.setItem(USER_KEY, JSON.stringify(signedInUser)); localStorage.setItem(TOKEN_KEY, result.token);
      setUser(signedInUser); setToken(result.token);
      const destination = ['Moderator', 'Administrator'].includes(role) ? 'admin' : 'dashboard';
      navigate(destination); setSuccess(`Welcome, ${signedInUser.displayName || signedInUser.email}.`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function handleReportMapPick(coords) {
    const requestId = ++reportMapPickSequence.current;
    if (!coords) {
      setPickedLocation(null);
      setReportLocationFeedback('Map pin cleared. Enter a place name to locate it automatically, or select a new pin.');
      return;
    }
    const fallbackLabel = `Map-selected location (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`;
    setPickedLocation({ ...coords, label: fallbackLabel });
    setReportAreaName(fallbackLabel);
    setReportLocationFeedback('Pin selected. Looking up the suburb or town name…');
    const areaName = await reverseGeocodeSouthAfricanPlace(coords);
    if (requestId !== reportMapPickSequence.current) return;
    if (areaName) {
      setPickedLocation({ ...coords, label: areaName });
      setReportAreaName(areaName);
      setReportLocationFeedback(`Selected area: ${areaName}. You can edit the area name if needed.`);
    } else {
      setReportLocationFeedback('The map pin is selected and can be submitted. We could not retrieve a place name, so the area field shows the selected coordinates.');
    }
  }

  async function handleSightingMapPick(coords) {
    const requestId = ++sightingMapPickSequence.current;
    if (!coords) {
      setPickedSightingLocation(null);
      setSightingLocationFeedback('Map pin cleared. Enter a place name to locate it automatically, or select a new pin.');
      return;
    }
    const fallbackLabel = `Map-selected location (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`;
    setPickedSightingLocation({ ...coords, label: fallbackLabel });
    setSightingAreaName(fallbackLabel);
    setSightingLocationFeedback('Pin selected. Looking up the suburb or town name…');
    const areaName = await reverseGeocodeSouthAfricanPlace(coords);
    if (requestId !== sightingMapPickSequence.current) return;
    if (areaName) {
      setPickedSightingLocation({ ...coords, label: areaName });
      setSightingAreaName(areaName);
      setSightingLocationFeedback(`Selected area: ${areaName}. You can edit the area name if needed.`);
    } else {
      setSightingLocationFeedback('The map pin is selected and can be submitted. We could not retrieve a place name, so the area field shows the selected coordinates.');
    }
  }

  async function handleReport(event) {
    event.preventDefault(); const formElement = event.currentTarget; setError(''); setSuccess('');
    if (!user || !token) { setError('Please sign in before submitting a missing-person report.'); navigate('auth'); return; }
    const form = new FormData(formElement);
    const uploadedPhoto = form.get('photo');
    const hasExistingPhoto = Boolean(editingCase?.photoUrl || editingCase?.photoStorageKey || editingCase?.photoName);
    if ((!uploadedPhoto || !uploadedPhoto.size) && !hasExistingPhoto) {
      setError('Upload a recent photograph before submitting this report.');
      return;
    }
    if (uploadedPhoto?.size) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(uploadedPhoto.type)) {
        setError('The recent photograph must be a JPEG, PNG or WebP image.');
        return;
      }
      if (uploadedPhoto.size > 5 * 1024 * 1024) {
        setError('The photograph must be 5 MB or smaller.');
        return;
      }
    }
    const rawLastSeenAt = String(form.get('lastSeenAt') || '');
    if (!rawLastSeenAt || Number.isNaN(new Date(rawLastSeenAt).getTime())) { setError('Enter a valid last-seen date and time.'); return; }
    if (new Date(rawLastSeenAt).getTime() > Date.now()) { setError('Last-seen date and time cannot be in the future.'); return; }
    const placeName = String(reportAreaName || form.get('publicAreaName') || '').trim();
    if (!placeName) { setError('Enter a suburb or public place for the last-known location.'); return; }
    setBusy(true);
    try {
      // If the user typed an area but did not click the map, look up the coordinates automatically.
      let reportLocation = pickedLocation;
      if (!reportLocation) {
        setSuccess('Looking up the place you entered…');
        reportLocation = await geocodeSouthAfricanPlace(placeName);
        if (!reportLocation) {
          setSuccess('');
          setError(`We couldn't locate “${placeName}” automatically. Check the spelling or click the approximate location on the map, then submit again.`);
          return;
        }
        setPickedLocation(reportLocation);
      }
      setSuccess('');
      const data = {
        personName: form.get('personName'), ageAtDisappearance: form.get('ageAtDisappearance'), description: form.get('description'),
        clothingDescription: form.get('clothingDescription'), lastSeenAt: new Date(rawLastSeenAt).toISOString(), publicAreaName: placeName,
        lastSeenLatitude: reportLocation.lat, lastSeenLongitude: reportLocation.lng, contactName: form.get('contactName'),
        contactPhone: form.get('contactPhone'), contactEmail: form.get('contactEmail'),
        publishContactDetails: form.get('publishContactDetails') === 'on', circumstances: form.get('circumstances'),
        confirmsRightToShare: form.get('confirmsRightToShare') === 'on', photo: form.get('photo')?.size ? form.get('photo') : null
      };
      const result = editingCase
        ? await updateMissingPersonCase(editingCase.id, data, token, user)
        : await createMissingPersonCase(data, token, user);
      const confirmation = editingCase
        ? `Report ${result.caseReference || ''} updated and sent back for administrator approval. It is hidden from public alerts until approved again.`
        : `Report received. Reference: ${result.caseReference || 'submitted'}. It is awaiting review and is not yet a public alert.`;
      formElement.reset(); setEditingCase(null); setPickedLocation(null); setReportAreaName(''); setReportLocationFeedback(''); await refreshAlerts(); await refreshMine(); await refreshNotifications(); navigate('myreports'); setSuccess(confirmation);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function handleSighting(event) {
    event.preventDefault(); const formElement = event.currentTarget; setError(''); setSuccess('');
    const form = new FormData(formElement);
    const rawSeenAt = String(form.get('seenAt') || '');
    if (!rawSeenAt || Number.isNaN(new Date(rawSeenAt).getTime())) { setError('Enter a valid sighting date and time.'); return; }
    if (new Date(rawSeenAt).getTime() > Date.now()) { setError('Sighting date and time cannot be in the future.'); return; }
    const placeName = String(sightingAreaName || form.get('publicAreaName') || '').trim();
    if (!placeName) { setError('Enter a suburb or public place for the sighting.'); return; }
    setBusy(true);
    try {
      // Use the typed sighting area when a map pin has not been selected manually.
      let sightingLocation = pickedSightingLocation;
      if (!sightingLocation) {
        setSuccess('Looking up the sighting location…');
        sightingLocation = await geocodeSouthAfricanPlace(placeName);
        if (!sightingLocation) {
          setSuccess('');
          setError(`We couldn't locate “${placeName}” automatically. Check the spelling or click the approximate location on the map, then submit again.`);
          return;
        }
        setPickedSightingLocation(sightingLocation);
      }
      setSuccess('');
      const contactName = String(form.get('contactName') || '').trim();
      const contactEmail = String(form.get('contactEmail') || '').trim();
      const result = await submitSighting({
        caseId: form.get('caseId'), description: form.get('description'), publicAreaName: placeName,
        seenAt: new Date(rawSeenAt).toISOString(), isAnonymous: !contactName && !contactEmail, contactName, contactEmail,
        sightingLatitude: sightingLocation.lat, sightingLongitude: sightingLocation.lng
      }, token);
      const confirmation = `${result.message || 'Sighting received.'} It remains private until an administrator reviews it.`;
      formElement.reset(); setPickedSightingLocation(null); setSightingAreaName(''); setSightingLocationFeedback(''); await refreshAdmin(); navigate('alerts'); setSuccess(confirmation);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function handleSubscribe(event) {
    event.preventDefault(); setError(''); setSuccess('');
    if (!user || !token) { setError('Sign in to subscribe to local alerts.'); navigate('auth'); return; }
    if (!subscriptionArea || subscriptionArea === 'All areas') { setError('Choose a specific area first.'); return; }
    setBusy(true);
    try { await createAreaSubscription(subscriptionArea, token, user); await refreshSubscriptions(); setSuccess(`You are subscribed to alerts for ${subscriptionArea}.`); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function removeSubscription(id) {
    setError(''); setSuccess('');
    try { await deleteAreaSubscription(id, token); await refreshSubscriptions(); setSuccess('Area subscription removed.'); }
    catch (e) { setError(e.message); }
  }

  async function moderateCase(id, action) {
    setError(''); setSuccess(''); setBusy(true);
    try {
      await reviewCase(id, action, token);
      setSuccess(action === 'approve' ? 'Case approved. It can now appear in public alerts.' : 'Case rejected and kept out of public alerts.');
      await Promise.all([refreshAlerts(), refreshPublicSightings(), refreshAdmin(), refreshMine(), refreshNotifications()]);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function updateFoundStatus(id, status) {
    const item = alerts.find(entry => String(entry.id) === String(id)) || activeAlerts.find(entry => String(entry.id) === String(id));
    const statusLabel = status === 'FoundSafe' ? 'Found Safe' : 'Found Deceased';
    if (status === 'FoundDeceased') {
      const personLabel = item?.personName ? ` for ${item.personName}` : '';
      if (!window.confirm(`Confirm that this person has been found deceased${personLabel}? This will update the public report and remove related possible sightings from public display.`)) return;
    }
    setError(''); setSuccess(''); setBusy(true);
    try {
      await updateCaseStatus(id, status, token);
      setSuccess(`Case status updated to ${statusLabel}.`);
      await Promise.all([refreshAlerts(), refreshPublicSightings(), refreshAdmin(), refreshMine(), refreshNotifications()]);
      if (selectedAlert && String(selectedAlert.id) === String(id)) setSelectedAlert({ ...selectedAlert, caseStatus: status });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function correctFoundStatus(id, status) {
    if (user?.role !== 'Administrator') { setError('Only an administrator can correct a found-status decision.'); return; }
    const item = alerts.find(entry => String(entry.id) === String(id));
    if (!item || !['FoundSafe', 'FoundDeceased'].includes(item.caseStatus)) { setError('This case is not eligible for a status correction.'); return; }
    const targetLabel = status === 'Active' ? 'Active — person is still missing' : status === 'FoundSafe' ? 'Found Safe' : 'Found Deceased';
    const reason = window.prompt(`Explain why the previous status for ${item.personName} must be corrected. This reason is recorded in the audit trail (at least 10 characters).`, '');
    if (reason === null) return;
    if (reason.trim().length < 10) { setError('Enter a correction reason of at least 10 characters.'); return; }
    if (!window.confirm(`Correct ${item.personName}'s status from ${caseStatusLabel(item.caseStatus)} to ${targetLabel}? The public alert and map will update. Related old sightings will remain hidden until freshly reviewed.

Reason: ${reason.trim()}`)) return;
    setError(''); setSuccess(''); setBusy(true);
    try {
      await correctCaseStatus(id, status, reason.trim(), token);
      setSuccess(`Case status corrected to ${targetLabel}. The correction was recorded in the audit trail and notifications were sent.`);
      await Promise.all([refreshAlerts(), refreshPublicSightings(), refreshAdmin(), refreshMine(), refreshNotifications()]);
      if (selectedAlert && String(selectedAlert.id) === String(id)) setSelectedAlert({ ...selectedAlert, caseStatus: status });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function moderateTip(id, action) {
    setError(''); setSuccess(''); setBusy(true);
    try { await reviewSighting(id, action, token); setSuccess(action === 'approve' ? 'Sighting approved for display as a possible sighting.' : 'Sighting rejected and kept off public maps.'); await Promise.all([refreshAdmin(), refreshPublicSightings(), refreshAlerts()]); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const isModerator = ['Moderator', 'Administrator'].includes(user?.role);
  const showAlertBanner = (error || success) && page !== 'auth';

  return <div className="app-shell">
    <div className="safety-strip"><ShieldCheck size={15} /><span>Community support starts with responsible reporting. This application is not an emergency service.</span><button onClick={() => setPage('safety')}>Safety guidance <ArrowRight size={13} /></button></div>
    <header className="site-header">
      <button className="brand" onClick={() => navigate('home')} aria-label="Missing Person Alert home"><span className="brand-mark"><UserRoundSearch size={25} /></span><span className="brand-words"><strong>MISSING PERSON</strong><small>ALERT</small></span></button>
      <button className="mobile-menu" aria-label="Toggle navigation" onClick={() => setShowMobileNav(v => !v)}>{showMobileNav ? <X /> : <Menu />}</button>
      <nav className={`main-nav ${showMobileNav ? 'nav-open' : ''}`}>
        {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'nav-link active' : 'nav-link'} onClick={() => navigate(id)}><Icon size={17} />{label}</button>)}
        {user && !isModerator && <button className={page === 'dashboard' ? 'nav-link active' : 'nav-link'} onClick={() => navigate('dashboard')}><Home size={17} />My dashboard</button>}
        {user && !isModerator && <button className={page === 'myreports' ? 'nav-link active' : 'nav-link'} onClick={() => navigate('myreports')}><FileText size={17} />My reports</button>}
        {user && <button className={page === 'notifications' ? 'nav-link active' : 'nav-link'} onClick={() => navigate('notifications')}><Bell size={17} />Notifications{notifications.filter(n => !n.isRead).length > 0 && <span className="nav-count">{notifications.filter(n => !n.isRead).length}</span>}</button>}
        {isModerator && <button className={page === 'admin' ? 'nav-link active' : 'nav-link'} onClick={() => navigate('admin')}><ShieldCheck size={17} />Admin dashboard{pendingCases.length + pendingSightings.length > 0 && <span className="nav-count">{pendingCases.length + pendingSightings.length}</span>}</button>}
      </nav>
      <div className="header-actions">
        {user ? <div className="profile-menu"><span className="profile-avatar"><User size={16} /></span><span className="profile-name">{user.displayName || user.email}</span><button className="icon-button" onClick={signOut} title="Sign out" aria-label="Sign out"><LogOut size={17} /></button></div>
          : <button className="button button-primary button-small" onClick={() => { setAuthMode('login'); navigate('auth'); }}><LogIn size={16} /> Sign in</button>}
      </div>
    </header>

    {showAlertBanner && <div className={`message-banner ${error ? 'message-error' : 'message-success'}`}><span>{error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}{error || success}</span><button onClick={() => { setError(''); setSuccess(''); }} aria-label="Dismiss message"><X size={16} /></button></div>}

    <main className="main-content">
      {page === 'home' && <>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow"><span className="live-dot" /> COMMUNITY-POWERED ALERTS</span>
            <h1>When someone is missing, <em>every moment matters.</em></h1>
            <p>Missing Person Alert helps families, communities and authorised reviewers share missing-person information responsibly, bring sightings together and keep case updates in one place.</p>
            <div className="hero-actions"><button className="button button-primary" onClick={() => navigate('report')}>Report a missing person <ArrowRight size={17} /></button><button className="button button-outline" onClick={() => navigate('alerts')}>View active alerts</button></div>
            <div className="hero-points"><span><ShieldCheck size={16} /> Review before publishing</span><span><MapPin size={16} /> Local area alerts</span><span><HeartHandshake size={16} /> Community support</span></div>
          </div>
          <div className="hero-visual" aria-label="Illustration of community members collaborating">
            <div className="visual-orbit orbit-one" /><div className="visual-orbit orbit-two" />
            <div className="visual-center"><UserRoundSearch size={58} strokeWidth={1.35} /></div>
            <div className="float-card card-alert"><span className="mini-icon orange"><Bell size={17} /></span><span><strong>Alert review</strong><small>Reports checked before sharing</small></span><CheckCircle2 size={18} className="green-icon" /></div>
            <div className="float-card card-map"><span className="mini-icon teal"><MapPin size={18} /></span><span><strong>Local communities</strong><small>Relevant area information</small></span></div>
            <div className="visual-tag"><Users size={15} /> Together, we look out for one another</div>
          </div>
        </section>

        <section className="urgent-callout"><span className="urgent-icon"><Siren size={23} /></span><div><strong>If someone is missing, contact SAPS immediately.</strong><p>There is no need to wait before making a missing-person report. Missing Person Alert does not replace the police or emergency services.</p></div><button className="button button-light" onClick={() => navigate('safety')}>Read safety guidance <ArrowRight size={16} /></button></section>

        <section className="section-block">
          <div className="section-heading"><div><span className="eyebrow">COMMUNITY ALERTS</span><h2>Recently shared alerts</h2><p>Only approved cases are shown here. Check each alert's status and timestamp.</p></div><button className="text-button" onClick={() => navigate('alerts')}>See all alerts <ArrowRight size={16} /></button></div>
          {loading ? <div className="loading-line">Loading alerts…</div> : activeAlerts.length ? <div className="alert-grid">{activeAlerts.slice(0, 3).map(item => <AlertCard key={item.id} item={item} onOpen={openAlert} />)}</div> : <EmptyState title="No public alerts to show" text="When a report is reviewed and approved, it can appear here." icon={Search} />}
        </section>

        <section className="how-section"><div className="section-heading centered"><div><span className="eyebrow">HOW IT WORKS</span><h2>One place to coordinate the next step</h2><p>Designed to keep reports organised and reduce confusion during a stressful time.</p></div></div><div className="steps-grid">
          <div className="step-card"><span className="step-number">01</span><span className="step-icon"><FileText size={22} /></span><h3>Submit a report</h3><p>Share the key details, last-known area and a way for a reviewer to contact you.</p></div>
          <div className="step-card"><span className="step-number">02</span><span className="step-icon"><ShieldCheck size={22} /></span><h3>Review and approve</h3><p>An application moderator checks information before it is displayed publicly.</p></div>
          <div className="step-card"><span className="step-number">03</span><span className="step-icon"><Users size={22} /></span><h3>Share useful sightings</h3><p>Community members can pass potential sightings to the review team safely.</p></div>
        </div></section>
        <section className="bottom-cta"><div><span className="eyebrow">STAY INFORMED, ACT RESPONSIBLY</span><h2>Help information reach the right people.</h2><p>Share approved alerts with care, avoid rumours, and send possible sightings to the appropriate authorities or case reviewers.</p></div><button className="button button-primary" onClick={() => navigate('alerts')}>Browse alerts <ArrowRight size={17} /></button></section>
      </>}

      {page === 'alerts' && <section className="page-section">
        <div className="page-heading"><div><span className="eyebrow">PUBLIC ALERTS</span><h1>Missing people in the community</h1><p>Browse moderator-approved records. Public map positions are approximate for safety.</p></div><button className="button button-primary" onClick={() => navigate('report')}><PlusCircle size={17} /> Submit a report</button></div>
        {user && <section className="subscription-panel"><div className="subscription-copy"><span className="subscription-icon"><Bell size={19} /></span><div><h3>Get alerts for your area</h3><p>Choose an area you care about. Notifications are sent when matching alerts are approved.</p></div></div><form className="subscription-form" onSubmit={handleSubscribe}><select aria-label="Choose an area to subscribe to" value={subscriptionArea} onChange={e => setSubscriptionArea(e.target.value)}><option value="">Choose area</option>{areas.filter(a => a !== 'All areas').map(area => <option key={area} value={area}>{area}</option>)}</select><button className="button button-primary button-small" disabled={busy || areas.length <= 1} type="submit">Subscribe</button></form>{subscriptions.length > 0 && <div className="subscription-tags">{subscriptions.map(sub => <span className="subscription-tag" key={sub.id}>{sub.areaName}<button type="button" aria-label={`Unsubscribe from ${sub.areaName}`} onClick={() => removeSubscription(sub.id)}><X size={13} /></button></span>)}</div>}</section>}
        <div className="filter-bar"><div className="search-input"><Search size={18} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, reference or area" aria-label="Search alerts" /></div><div className="select-wrap"><Filter size={16} /><select value={areaFilter} onChange={e => setAreaFilter(e.target.value)} aria-label="Filter by area">{areas.map(area => <option key={area}>{area}</option>)}</select><ChevronDown size={15} /></div><span className="results-count">{filteredAlerts.length} {filteredAlerts.length === 1 ? 'alert' : 'alerts'}</span></div>
        <div className="alerts-layout"><div className="alert-list">{filteredAlerts.map(item => <AlertCard key={item.id} item={item} onOpen={openAlert} />)}{filteredAlerts.length === 0 && (activeAlerts.length === 0 ? <EmptyState title="No public alerts yet" text="New reports will appear here only after an administrator approves them." icon={Search} /> : <EmptyState title="No matching alerts" text="Try a different search or select All areas." icon={Search} />)}</div><aside className="map-panel"><div className="map-panel-heading"><div><h3>Alert map</h3><p>Approximate locations only</p></div><MapPin size={19} /></div><AlertsMap alerts={filteredAlerts} sightings={visibleSightings} onOpen={openAlert} /><div className="map-panel-foot"><span className="map-legend-dot" /> Active alert <span className="map-legend-dot found-dot" /> Found safe <span className="map-legend-dot deceased-dot" /> Found deceased {visibleSightings.length > 0 && <><span className="map-legend-dot sighting-dot" /> Reviewed possible sighting</>}</div></aside></div>
      </section>}

      {page === 'detail' && selectedAlert && <section className="page-section detail-section">
        <button className="back-link" onClick={() => navigate('alerts')}>← Back to alerts</button>
        <div className="detail-grid"><article className="detail-main"><div className="detail-banner"><span className="detail-person-icon"><UserRoundSearch size={35} /></span><span className="eyebrow">CASE {selectedAlert.caseReference}</span><StatusPill status={selectedAlert.caseStatus} /><h1>{selectedAlert.personName}</h1><p>{selectedAlert.ageAtDisappearance ? `${selectedAlert.ageAtDisappearance} years old` : 'Age not confirmed'} · {selectedAlert.publicAreaName}</p></div>
          {selectedAlert.photoUrl && <div className="detail-photo-wrap"><img src={resolveMediaUrl(selectedAlert.photoUrl)} alt={`Approved photo supplied for ${selectedAlert.personName}`} /></div>}
          <div className="detail-info-grid"><div className="detail-info"><span>Last seen</span><strong>{dateLabel(selectedAlert.lastSeenAt)}</strong></div><div className="detail-info"><span>Reported area</span><strong>{selectedAlert.publicAreaName || 'Not provided'}</strong></div><div className="detail-info"><span>Clothing</span><strong>{selectedAlert.clothingDescription || 'No clothing details supplied'}</strong></div><div className="detail-info"><span>Alert review</span><strong>{selectedAlert.reviewStatus === 'Approved' ? 'Approved by an application moderator' : selectedAlert.reviewStatus}</strong></div></div>
          {(selectedAlert.contactPhone || selectedAlert.contactEmail) ? <section className="public-contact-panel"><div className="public-contact-heading"><div><span className="eyebrow">REPORTER CONTACT DETAILS</span><h3>Contact the reporter</h3><p>The reporter agreed to make these details public for this alert.</p></div><User size={20} /></div>{selectedAlert.contactName && <p className="public-contact-name">{selectedAlert.contactName}</p>}<div className="public-contact-actions">{selectedAlert.contactPhone && <a className="public-contact-link" href={`tel:${String(selectedAlert.contactPhone).replace(/[^+\d]/g, '')}`}><Phone size={17} /><span><small>Phone</small><strong>{selectedAlert.contactPhone}</strong></span></a>}{selectedAlert.contactEmail && <a className="public-contact-link" href={`mailto:${selectedAlert.contactEmail}`}><Mail size={17} /><span><small>Email</small><strong>{selectedAlert.contactEmail}</strong></span></a>}</div></section> : <section className="public-contact-panel contact-private-panel"><div className="public-contact-heading"><div><span className="eyebrow">REPORTER CONTACT DETAILS</span><h3>Send information about this case</h3><p>The reporter has not chosen to publish their phone number or email on this alert.</p></div><ShieldCheck size={20} /></div>{selectedAlert.caseStatus === 'Active' && <button className="button button-primary button-small" onClick={() => navigate('sighting')}>Send a possible sighting</button>}</section>}
          <div className="detail-description"><h3>Description and information</h3><p>{selectedAlert.description}</p></div>
          {selectedAlert.caseStatus === 'Active' && <section className="reviewed-sightings"><div className="reviewed-sightings-heading"><div><h3>Possible sightings</h3><p>These sightings have been reviewed by an application moderator. They are not proof that the person has been found.</p></div><MapPin size={19} /></div>{publicSightings.filter(s => String(s.caseId) === String(selectedAlert.id)).length ? <div className="reviewed-sightings-list">{publicSightings.filter(s => String(s.caseId) === String(selectedAlert.id)).map(sighting => <article className="reviewed-sighting-item" key={sighting.id}><div><strong>{sighting.publicAreaName}</strong><span>{dateLabel(sighting.seenAt)} · Moderator-reviewed possible sighting</span></div><p>{sighting.description}</p></article>)}</div> : <p className="reviewed-sightings-empty">No moderator-reviewed possible sightings have been published for this report yet.</p>}</section>}
          <div className="privacy-note"><ShieldCheck size={18} /><div><strong>Protect the person's privacy</strong><p>Do not repost unverified claims, exact addresses or private details. Contact the reporter using the details shown here only when they have chosen to publish them; otherwise use the sighting form or contact SAPS directly.</p></div></div>
          <div className="detail-actions">{selectedAlert.caseStatus === 'Active' && <button className="button button-primary" onClick={() => { navigate('sighting'); }}><MapPin size={17} /> Submit a possible sighting</button>}<button className="button button-outline" onClick={() => { navigator.clipboard?.writeText(`${selectedAlert.personName} — ${selectedAlert.caseReference} — ${selectedAlert.publicAreaName}`); setSuccess('Alert summary copied. Check that you are sharing only approved information.'); }}><ArrowDownRight size={16} /> Copy alert summary</button><button className="button button-outline" onClick={shareSelectedAlertOnWhatsApp}><Users size={16} /> Share report on WhatsApp</button></div>
        </article><aside className="detail-side">{selectedAlert.caseStatus === 'Active' && <div className="side-card"><h3>Have information?</h3><p>Submit what you observed, including an approximate area and time. A sighting is not treated as confirmed until reviewed.</p><button className="button button-primary button-full" onClick={() => navigate('sighting')}>Share a sighting</button></div>}<div className="side-card side-safety"><Siren size={22} /><h3>Urgent information?</h3><p>Contact SAPS directly. Do not rely on a web submission for emergency assistance.</p><button className="text-button" onClick={() => navigate('safety')}>Safety guidance <ArrowRight size={15} /></button></div></aside></div>
      </section>}

      {page === 'report' && <section className="page-section form-page"><div className="page-heading"><div><span className="eyebrow">{editingCase ? 'EDIT YOUR REPORT' : 'REPORT A MISSING PERSON'}</span><h1>{editingCase ? 'Update report details' : 'Share the important details'}</h1><p>{editingCase ? 'Your changes will send this report back for administrator approval. It will not be public until approved again.' : 'Required fields are marked with an asterisk. The report will not be public until reviewed.'}</p></div><span className="form-privacy"><ShieldCheck size={18} /> {editingCase ? 'Edits require approval again' : 'Submitted reports stay pending until reviewed'}</span></div>
        {!user ? <div className="auth-required"><LockIcon /><h3>Sign in to submit a report</h3><p>This helps us connect a report with the person submitting it. The app is not a replacement for reporting to SAPS.</p><button className="button button-primary" onClick={() => { setAuthMode('login'); navigate('auth'); }}>Sign in or register</button></div> : <form key={editingCase ? `edit-${editingCase.id}` : 'new-report'} className="form-card" onSubmit={handleReport}>
          <div className="form-section-title"><span>01</span><div><h2>Person details</h2><p>Enter the information you can confirm.</p></div></div>
          <div className="form-grid"><Field label="Full name" required><input name="personName" required maxLength="120" defaultValue={editingCase?.personName || ''} placeholder="Name of the missing person" /></Field><Field label="Age when last seen" required><input name="ageAtDisappearance" type="number" min="0" max="120" required defaultValue={editingCase?.ageAtDisappearance ?? ''} placeholder="Age" /></Field><Field label="Description" required hint="Include distinguishing features only when helpful; avoid sensitive assumptions."><textarea name="description" required minLength="10" maxLength="2000" rows="3" defaultValue={editingCase?.description || ''} placeholder="Height, hair, identifying details…" /></Field><Field label="Clothing last seen wearing" hint="Include colour and type of clothing, if known."><input name="clothingDescription" maxLength="300" defaultValue={editingCase?.clothingDescription || ''} placeholder="e.g. navy jacket, light trousers" /></Field><Field label="Date and time last seen" required><input name="lastSeenAt" type="datetime-local" max={maxDateTime} required defaultValue={editingCase?.lastSeenAt ? localDateTimeValue(new Date(editingCase.lastSeenAt)) : ''} /></Field><Field label="Last-known suburb or area" required hint="Use a general area; do not include a private home address in public details."><input name="publicAreaName" value={reportAreaName} onChange={event => { setReportAreaName(event.target.value); setPickedLocation(null); setReportLocationFeedback(''); reportMapPickSequence.current += 1; }} required maxLength="150" placeholder="e.g. Scottsville, Pietermaritzburg" /></Field><FieldGroup label="Approximate last-known map location" hint="Click anywhere on the map to select a pin. The suburb or area above will be filled automatically when available. If the lookup service is unavailable, the selected coordinates are still saved."><LocationPicker value={pickedLocation} onChange={handleReportMapPick} statusMessage={reportLocationFeedback} /></FieldGroup><Field label="Additional circumstances" hint="Do not include passwords, identity numbers or unrelated private details."><textarea name="circumstances" maxLength="1500" rows="3" defaultValue={editingCase?.circumstances || ''} placeholder="Anything else that may help the reviewer…" /></Field><Field label="Recent photograph" required={!Boolean(editingCase?.photoUrl || editingCase?.photoStorageKey || editingCase?.photoName)} hint={Boolean(editingCase?.photoUrl || editingCase?.photoStorageKey || editingCase?.photoName) ? 'A photograph is already attached. Upload a replacement if it needs updating.' : 'Required for every new report. JPEG, PNG or WebP, maximum 5 MB. Only upload an image you are authorised to share.'}><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required={!Boolean(editingCase?.photoUrl || editingCase?.photoStorageKey || editingCase?.photoName)} /></Field></div>
          <div className="form-section-title spaced"><span>02</span><div><h2>Reporter contact details</h2><p>Reviewers can always see these details. They appear on the public alert only if you choose to publish them.</p></div></div>
          <div className="form-grid"><Field label="Your name" required><input name="contactName" required maxLength="120" defaultValue={editingCase?.contactName || user.displayName || ''} placeholder="Your name" /></Field><Field label="Contact phone" required><input name="contactPhone" type="tel" required maxLength="30" autoComplete="tel" defaultValue={editingCase?.contactPhone || ''} placeholder="A number a reviewer can use" /></Field><Field label="Contact email" required><input name="contactEmail" type="email" required maxLength="254" autoComplete="email" defaultValue={editingCase?.contactEmail || user.email || ''} placeholder="you@example.com" /></Field></div>
          <label className="consent-row public-contact-consent"><input name="publishContactDetails" type="checkbox" defaultChecked={editingCase?.publishContactDetails === true} /><span><strong>Publish my contact details on the public alert.</strong> If selected, your name, phone number and email will be visible to anyone viewing the approved report and may be included when the report is shared. Leave this unchecked to keep them private; people can still submit a possible sighting.</span></label>
          <label className="consent-row"><input name="confirmsRightToShare" type="checkbox" required /><span>I confirm that the information is accurate to the best of my knowledge and that I am authorised to submit the information and photograph, where applicable.</span></label>
          <div className="form-footnote"><Info size={17} /><span>For safety, your report starts as <strong>Pending review</strong>. Do not wait for this application before contacting SAPS about a real missing person.</span></div>
          <div className="form-actions"><button className="button button-outline" type="button" onClick={() => navigate(editingCase ? 'myreports' : 'home')}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? (editingCase ? 'Saving changes…' : 'Submitting…') : (editingCase ? 'Save changes and send for approval' : 'Submit for review')} <ArrowRight size={16} /></button></div>
        </form>}
      </section>}

      {page === 'sighting' && <section className="page-section form-page"><div className="page-heading"><div><span className="eyebrow">COMMUNITY TIP</span><h1>Share a possible sighting</h1><p>Only report what you personally observed. A tip is not proof that a person has been found.</p></div></div>
        <div className="inline-warning wide-warning"><AlertCircle size={18} /><span>If someone appears to be in immediate danger, contact emergency services directly. Do not approach a situation that could put you or another person at risk.</span></div>
        <form className="form-card" onSubmit={handleSighting}><div className="form-grid"><Field label="Related alert" required><select name="caseId" required value={sightingCaseId} onChange={e => setSightingCaseId(e.target.value)}><option value="" disabled>Select a public alert</option>{activeAlerts.filter(a => a.caseStatus === 'Active').map(a => <option key={a.id} value={a.id}>{a.caseReference} — {a.personName}</option>)}</select></Field><Field label="When did you see them?" required><input name="seenAt" type="datetime-local" max={maxDateTime} required /></Field><Field label="Approximate area of sighting" required><input name="publicAreaName" value={sightingAreaName} onChange={event => { setSightingAreaName(event.target.value); setPickedSightingLocation(null); setSightingLocationFeedback(''); sightingMapPickSequence.current += 1; }} required maxLength="150" placeholder="Suburb or public place, not an exact address" /></Field><FieldGroup label="Approximate map location" hint="Click anywhere on the map to select a pin. The suburb or area above will be filled automatically when available."><LocationPicker value={pickedSightingLocation} onChange={handleSightingMapPick} statusMessage={sightingLocationFeedback} latitudeName="sightingLatitude" longitudeName="sightingLongitude" /></FieldGroup><Field label="What did you observe?" required><textarea name="description" required minLength="10" maxLength="2000" rows="4" placeholder="Describe what you observed, and distinguish facts from assumptions." /></Field></div>
          <div className="form-grid"><Field label="Your name (optional)"><input name="contactName" maxLength="120" autoComplete="name" placeholder="Name" /></Field><Field label="Your email (optional)"><input name="contactEmail" type="email" maxLength="254" autoComplete="email" placeholder="you@example.com" /></Field></div>
          <p className="field-hint tip-contact-note">Name and email are optional. Leave both blank if you prefer not to share contact details.</p>
          <div className="form-footnote"><ShieldCheck size={17} /><span>Tips are private to reviewers until checked. Do not upload graphic, invasive or unrelated material.</span></div>
          <div className="form-actions"><button className="button button-outline" type="button" onClick={() => navigate('alerts')}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit sighting'} <ArrowRight size={16} /></button></div>
        </form>
      </section>}

      {page === 'auth' && <section className="auth-page"><div className="auth-illustration"><span className="eyebrow">A COMMUNITY TOOL, BUILT AROUND CARE</span><h1>Information is most useful when it is shared responsibly.</h1><p>Sign in to submit reports, track your submissions and access the tools available to your role.</p><div className="auth-benefits"><span><CheckCircle2 size={17} /> Reports start private</span><span><CheckCircle2 size={17} /> Review before publishing</span><span><CheckCircle2 size={17} /> Case status updates</span></div></div><div className="auth-card"><div className="auth-tabs"><button className={authMode === 'login' ? 'active' : ''} onClick={() => { setAuthMode('login'); setError(''); }}>Sign in</button><button className={authMode === 'register' ? 'active' : ''} onClick={() => { setAuthMode('register'); setError(''); }}>Create account</button></div><h2>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h2><p>{authMode === 'login' ? 'Use your account details to continue.' : 'Register to submit reports and follow your submissions.'}</p><form onSubmit={handleAuth} className="auth-form">{authMode === 'register' && <Field label="Your name" required><input name="displayName" required maxLength="100" autoComplete="name" placeholder="Full name" /></Field>}<Field label="Email address" required><input name="email" required type="email" autoComplete="email" placeholder="you@example.com" /></Field><Field label="Password" required><input name="password" required type="password" minLength="8" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} placeholder="At least 8 characters" /></Field><button className="button button-primary button-full" disabled={busy} type="submit">{busy ? 'Please wait…' : authMode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={16} /></button></form>
          {error && <div className="message-banner message-error auth-error" role="alert"><span><AlertCircle size={18} />{error}</span><button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button></div>}
          <button className="back-link auth-back" onClick={() => navigate('home')}>← Return to home</button></div></section>}

      {page === 'dashboard' && <section className="page-section user-dashboard">
        {!user ? <div className="page-heading"><div><span className="eyebrow">USER DASHBOARD</span><h1>Sign in to continue</h1><p>Your personal dashboard keeps your reports and status updates together.</p></div><button className="button button-primary" onClick={() => { setAuthMode('login'); navigate('auth'); }}>Sign in <ArrowRight size={16} /></button></div>
          : isModerator ? <EmptyState title="Use the administrator dashboard" text="Your moderator account has access to the report review workspace." icon={ShieldCheck} /> : <>
            <div className="user-dashboard-heading"><div><span className="eyebrow">YOUR MISSING PERSON ALERT SPACE</span><h1>Welcome back, {(user.displayName || user.email || 'Community member').split(' ')[0]}.</h1><p>Submit a report, follow its review progress and receive relevant community updates from one place.</p></div><button className="button button-primary" onClick={() => navigate('report')}><PlusCircle size={17} /> Report a missing person</button></div>
            <div className="dashboard-stat-grid">
              <article className="dashboard-stat"><span className="dashboard-stat-icon navy"><FileText size={19} /></span><div><small>Your reports</small><strong>{myCases.length}</strong></div></article>
              <article className="dashboard-stat"><span className="dashboard-stat-icon amber"><Clock3 size={19} /></span><div><small>Awaiting review</small><strong>{myCases.filter(item => item.reviewStatus === 'Pending').length}</strong></div></article>
              <article className="dashboard-stat"><span className="dashboard-stat-icon green"><CheckCircle2 size={19} /></span><div><small>Approved reports</small><strong>{myCases.filter(item => item.reviewStatus === 'Approved').length}</strong></div></article>
              <article className="dashboard-stat"><span className="dashboard-stat-icon teal"><Bell size={19} /></span><div><small>Unread updates</small><strong>{notifications.filter(item => !item.isRead).length}</strong></div></article>
            </div>
            <div className="dashboard-columns">
              <section className="dashboard-panel"><div className="dashboard-panel-heading"><div><span className="eyebrow">FOLLOW YOUR SUBMISSIONS</span><h2>Recent reports</h2></div><button className="text-button" onClick={() => navigate('myreports')}>View all <ArrowRight size={15} /></button></div>
                {myCases.length ? <div className="dashboard-recent-list">{myCases.slice(0, 4).map(item => <article className="dashboard-recent-item" key={item.id}><span className="dashboard-recent-icon"><FileText size={18} /></span><div className="dashboard-recent-main"><strong>{item.personName}</strong><span>{item.caseReference} · {item.publicAreaName || 'Area not provided'}</span><small>Submitted {dateLabel(item.createdAt)}</small></div><StatusPill status={item.reviewStatus} /></article>)}</div> : <EmptyState title="No reports submitted yet" text="Use Report a missing person to submit a report. It will remain private until reviewed." icon={FileText} />}
              </section>
              <section className="dashboard-panel dashboard-actions-panel"><div className="dashboard-panel-heading"><div><span className="eyebrow">QUICK ACTIONS</span><h2>What would you like to do?</h2></div></div>
                <button className="dashboard-action" onClick={() => navigate('report')}><span className="dashboard-action-icon"><PlusCircle size={19} /></span><span><strong>Report a missing person</strong><small>Provide details for moderator review.</small></span><ArrowRight size={16} /></button>
                <button className="dashboard-action" onClick={() => navigate('alerts')}><span className="dashboard-action-icon"><MapPin size={19} /></span><span><strong>Browse public alerts</strong><small>View cases approved for public sharing.</small></span><ArrowRight size={16} /></button>
                <button className="dashboard-action" onClick={() => navigate('sighting')}><span className="dashboard-action-icon"><HeartHandshake size={19} /></span><span><strong>Share a possible sighting</strong><small>Send information for the review team.</small></span><ArrowRight size={16} /></button>
                <button className="dashboard-action" onClick={() => navigate('notifications')}><span className="dashboard-action-icon"><Bell size={19} /></span><span><strong>Notifications</strong><small>{notifications.filter(item => !item.isRead).length} unread update(s).</small></span><ArrowRight size={16} /></button>
              </section>
            </div>
            <div className="dashboard-safety-note"><ShieldCheck size={20} /><p><strong>Reports are not published immediately.</strong> An application moderator reviews a submission before it can appear as a public alert. For a real missing person, contact SAPS immediately; This application is not an emergency service.</p></div>
          </>}
      </section>}

      {page === 'myreports' && <section className="page-section"><div className="page-heading"><div><span className="eyebrow">YOUR SUBMISSIONS</span><h1>My reports</h1><p>See the review status of the missing-person reports submitted by your account.</p></div><button className="button button-primary" onClick={() => navigate('report')}><PlusCircle size={17} /> New report</button></div>{!user ? <EmptyState title="Sign in to view your reports" text="Your submissions are linked to your account." icon={User} /> : myCases.length ? <div className="alert-grid">{myCases.map(item => <article className="alert-card" key={item.id}><div className="alert-card-top"><span className="reference">{item.caseReference}</span><StatusPill status={item.reviewStatus} /></div><h3>{item.personName}</h3><p className="muted">{item.publicAreaName}</p><p className="card-description">{item.description}</p><p className="muted">{item.publishContactDetails ? 'You agreed to publish your contact details if this report is approved.' : 'Your contact details will stay private on the public alert.'}</p><div className="card-meta"><Clock3 size={15} /> Submitted: {dateLabel(item.createdAt)}</div><div className="card-footer"><span>Case status: {caseStatusLabel(item.caseStatus)}</span><div className="card-footer-actions">{item.caseStatus === 'Active' && <button className="text-button" onClick={() => startEditingCase(item)}><Pencil size={14} /> Edit report</button>}{item.reviewStatus === 'Approved' && <button className="text-button" onClick={() => openAlert(item)}>View alert <ArrowRight size={15} /></button>}</div></div></article>)}</div> : <EmptyState title="No reports yet" text="When you submit a report, its review status will appear here." icon={FileText} />}</section>}

      {page === 'admin' && <section className="page-section"><div className="page-heading"><div><span className="eyebrow">ADMINISTRATOR WORKSPACE</span><h1>Administrator dashboard</h1><p>Review submitted reports and sightings, approve suitable alerts, and manage case status. Application approval is not official SAPS verification.</p></div><button className="button button-outline" onClick={() => { refreshAdmin(); refreshAlerts(); }}><ArrowRight size={16} /> Refresh queue</button></div>
        {!isModerator ? <EmptyState title="Moderator access required" text="Sign in with an authorised moderator account to review submissions." icon={ShieldCheck} /> : <>
          <div className="admin-tabs" role="tablist" aria-label="Administrator workspace tabs">
            <button type="button" role="tab" aria-selected={adminTab === 'review'} className={adminTab === 'review' ? 'admin-tab active' : 'admin-tab'} onClick={() => setAdminTab('review')}><ShieldCheck size={16} /> Review dashboard</button>
            {user?.role === 'Administrator' && <button type="button" role="tab" aria-selected={adminTab === 'audit'} className={adminTab === 'audit' ? 'admin-tab active' : 'admin-tab'} onClick={() => { setAdminTab('audit'); setAuditSkip(0); }}><ClipboardList size={16} /> Audit Trail</button>}
          </div>
          {adminTab === 'review' && <>
          <div className="admin-summary"><div><span>Pending reports</span><strong>{pendingCases.length}</strong></div><div><span>Pending sightings</span><strong>{pendingSightings.length}</strong></div><div><span>Approved public alerts</span><strong>{activeAlerts.length}</strong></div></div>
          <div className="admin-heading"><div><h2>Reports awaiting approval</h2><p>Check the details and suitability before a report becomes a public alert.</p></div></div>
          {pendingCases.length ? <div className="moderation-list">{pendingCases.map(item => <article className="moderation-card" key={item.id}><div className="moderation-title"><div><span className="reference">{item.caseReference}</span><h3>{item.personName}</h3><p>{item.ageAtDisappearance} years · {item.publicAreaName} · Last seen {dateLabel(item.lastSeenAt)}</p></div><StatusPill status="Pending" /></div><p className="moderation-description">{item.description}</p><div className="moderation-private"><strong>Reporter contact (restricted)</strong><span>{item.contactName || 'Not provided'} · {item.contactEmail || 'No email'} · {item.contactPhone || 'No phone'}</span><span>{item.publishContactDetails ? 'Reporter consented to public contact display if approved.' : 'Reporter contact details will remain private on the public alert.'}</span></div><div className="moderation-actions"><button className="button button-outline danger-outline" disabled={busy} onClick={() => moderateCase(item.id, 'reject')}><X size={16} /> Reject</button><button className="button button-primary" disabled={busy} onClick={() => moderateCase(item.id, 'approve')}><Check size={16} /> Approve public alert</button></div></article>)}</div> : <EmptyState title="No reports awaiting review" text="New submissions will appear here after they are sent." icon={CheckCircle2} />}
          <div className="admin-heading sightings-heading"><div><h2>Possible sightings</h2><p>Review tips discreetly. A sighting does not automatically confirm a person has been found.</p></div></div>
          {pendingSightings.length ? <div className="moderation-list">{pendingSightings.map(item => <article className="moderation-card" key={item.id}><div className="moderation-title"><div><span className="reference">{item.caseReference || `Sighting ${item.id}`}</span><h3>{item.publicAreaName}</h3><p>Observed: {dateLabel(item.seenAt)} · Received: {dateLabel(item.createdAt)}</p></div><StatusPill status="Pending" /></div><p className="moderation-description">{item.description}</p><div className="moderation-private"><strong>Contact preference</strong><span>{item.isAnonymous ? 'Anonymous tip' : `${item.contactName || 'No name'} · ${item.contactEmail || 'No email'}`}</span></div><div className="moderation-actions"><button className="button button-outline danger-outline" disabled={busy} onClick={() => moderateTip(item.id, 'reject')}><X size={16} /> Reject</button><button className="button button-primary" disabled={busy} onClick={() => moderateTip(item.id, 'approve')}><Check size={16} /> Approve sighting for map</button></div></article>)}</div> : <EmptyState title="No sightings awaiting review" text="New sighting tips will appear here." icon={MapPin} />}
          <div className="admin-heading sightings-heading"><div><h2>Active alerts</h2><p>Only update the outcome when it has been appropriately confirmed.</p></div></div><div className="active-admin-list">{activeAlerts.filter(a => a.caseStatus === 'Active').map(item => <div className="active-admin-row" key={item.id}><div><strong>{item.personName}</strong><span>{item.caseReference} · {item.publicAreaName}</span></div><button className="button button-outline button-small" disabled={busy} onClick={() => updateFoundStatus(item.id, 'FoundSafe')}>Mark found safe</button><button className="button button-outline button-small deceased-action" disabled={busy} onClick={() => updateFoundStatus(item.id, 'FoundDeceased')}>Mark found deceased</button></div>)}</div>
          {user?.role === 'Administrator' && <>
            <div className="admin-heading sightings-heading"><div><h2>Correct a found-status decision</h2><p>If a person was mistakenly marked found safe or found deceased, an administrator can correct the public status. A reason is required and saved in the audit trail.</p></div></div>
            <div className="active-admin-list">{activeAlerts.filter(a => ['FoundSafe', 'FoundDeceased'].includes(a.caseStatus)).map(item => <div className="active-admin-row correction-admin-row" key={`correction-${item.id}`}><div><strong>{item.personName}</strong><span>{item.caseReference} · {item.publicAreaName} · Current status: {caseStatusLabel(item.caseStatus)}</span></div><div className="correction-actions"><button className="button button-outline button-small" disabled={busy || item.caseStatus === 'Active'} onClick={() => correctFoundStatus(item.id, 'Active')}>Correct to active / still missing</button>{item.caseStatus !== 'FoundSafe' && <button className="button button-outline button-small" disabled={busy} onClick={() => correctFoundStatus(item.id, 'FoundSafe')}>Correct to found safe</button>}{item.caseStatus !== 'FoundDeceased' && <button className="button button-outline button-small deceased-action" disabled={busy} onClick={() => correctFoundStatus(item.id, 'FoundDeceased')}>Correct to found deceased</button>}</div></div>)}{activeAlerts.filter(a => ['FoundSafe', 'FoundDeceased'].includes(a.caseStatus)).length === 0 && <EmptyState title="No found-status cases to correct" text="Cases marked Found Safe or Found Deceased will appear here." icon={CheckCircle2} />}</div>
          </>}
          </>}
          {user?.role === 'Administrator' && adminTab === 'audit' && <section className="audit-trail-section" role="tabpanel" aria-label="Audit Trail">
            <div className="admin-heading audit-heading"><div><h2><ClipboardList size={21} /> Audit Trail</h2><p>Chronological record of important account, report, moderation, status and sighting actions. Entries are restricted to administrators and ordered newest first.</p></div><button className="button button-outline" disabled={auditLoading} onClick={refreshAuditTrail}><ArrowRight size={16} /> Refresh history</button></div>
            <form className="audit-toolbar" onSubmit={event => { event.preventDefault(); setAuditSkip(0); setAuditSearch(auditSearchInput); }}>
              <label className="audit-search-field"><span>Search audit history</span><div className="audit-search-control"><Search size={17} /><input value={auditSearchInput} onChange={event => setAuditSearchInput(event.target.value)} placeholder="Actor, case reference, action or details" /></div></label>
              <label className="audit-action-field"><span>Action type</span><select value={auditAction} onChange={event => { setAuditSkip(0); setAuditAction(event.target.value); }}><option value="All">All actions</option>{Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <button className="button button-primary" type="submit"><Filter size={16} /> Apply filters</button>
            </form>
            <div className="audit-results-summary"><span>{auditLoading ? 'Loading audit history…' : `${auditTotal.toLocaleString()} audit event(s) found`}</span><small>Private contact information and passwords are not included in audit details.</small></div>
            {auditLoading ? <div className="loading-line">Loading audit history…</div> : auditEntries.length ? <div className="audit-event-list">{auditEntries.map(entry => <article className="audit-event-card" key={entry.id}>
              <div className="audit-event-marker"><ClipboardList size={18} /></div>
              <div className="audit-event-main">
                <div className="audit-event-top"><div><span className="audit-action-chip">{auditActionLabel(entry.action)}</span><h3>{entry.entityLabel || `${entry.entityType || 'Record'} #${entry.entityId}`}</h3></div><time dateTime={entry.createdAt}>{dateLabel(entry.createdAt)}</time></div>
                <div className="audit-event-meta"><span><User size={14} /> {entry.actorDisplayName || 'Unavailable account'}{entry.actorEmail ? ` · ${entry.actorEmail}` : ''}</span><span><FileText size={14} /> {entry.entityType || 'Record'} #{entry.entityId}</span><span>Event ID: {entry.id}</span></div>
                <p>{entry.notes || 'No additional details were recorded for this action.'}</p>
              </div>
            </article>)}</div> : <EmptyState title="No audit events found" text={auditSearch || auditAction !== 'All' ? 'Try a different search term or action filter.' : 'Important activity will appear here as users submit reports, moderators review them and administrators change case statuses.'} icon={ClipboardList} />}
            <div className="audit-pagination"><span>{auditTotal ? `Showing ${auditSkip + 1}–${Math.min(auditSkip + auditEntries.length, auditTotal)} of ${auditTotal}` : 'No records on this page'}</span><div><button className="button button-outline button-small" disabled={auditLoading || auditSkip <= 0} onClick={() => setAuditSkip(value => Math.max(0, value - auditTake))}><ChevronLeft size={15} /> Previous</button><button className="button button-outline button-small" disabled={auditLoading || auditSkip + auditTake >= auditTotal} onClick={() => setAuditSkip(value => value + auditTake)}>Next <ChevronRight size={15} /></button></div></div>
          </section>}
        </>}</section>}

      {page === 'notifications' && <section className="page-section"><div className="page-heading"><div><span className="eyebrow">ACCOUNT UPDATES</span><h1>Notifications</h1><p>Review status and case updates connected to your account.</p></div><button className="button button-outline" onClick={refreshNotifications}><Bell size={16} /> Refresh</button></div>{!user ? <EmptyState title="Sign in to see notifications" text="Notifications are linked to your account." icon={Bell} /> : notifications.length ? <div className="notification-list">{notifications.map(item => <article className={`notification-card ${item.isRead ? 'read' : 'unread'}`} key={item.id}><span className="notification-icon"><Bell size={19} /></span><div className="notification-content"><h3>{item.title}</h3><p>{item.message}</p><small>{dateLabel(item.createdAt)}</small></div>{!item.isRead && <button className="text-button" onClick={async () => { try { await markNotificationRead(item.id, token); await refreshNotifications(); } catch (e) { setError(e.message); } }}>Mark read</button>}</article>)}</div> : <EmptyState title="You are all caught up" text="Case review and status updates will appear here." icon={CheckCircle2} />}</section>}

      {page === 'safety' && <section className="page-section safety-page"><div className="page-heading"><div><span className="eyebrow">PLEASE READ</span><h1>Missing-person safety guidance</h1><p>Use Missing Person Alert carefully. It is a community coordination prototype, not an emergency or law-enforcement service.</p></div><span className="safety-big-icon"><Siren size={28} /></span></div><div className="safety-cards"><article className="safety-card urgent"><span className="safety-card-icon"><Siren size={22} /></span><h2>Report immediately to SAPS</h2><p>Do not wait for an alert to spread or for a certain number of hours to pass. Contact the South African Police Service or visit your nearest police station as soon as you realise someone is missing.</p></article><article className="safety-card"><span className="safety-card-icon"><FileText size={22} /></span><h2>Prepare useful information</h2><p>Keep a recent photograph and share the person's name, description, clothing, the time and place they were last seen, and relevant circumstances with the police.</p></article><article className="safety-card"><span className="safety-card-icon"><ShieldCheck size={22} /></span><h2>Share responsibly</h2><p>Do not publish rumours, private addresses, identity numbers or unverified sightings. An application moderator approval does not mean SAPS has verified a case.</p></article><article className="safety-card"><span className="safety-card-icon"><HeartHandshake size={22} /></span><h2>Keep people safe</h2><p>Do not confront a person or suspected offender or put yourself at risk. Pass information to the authorities and use the application's tip process for follow-up.</p></article></div><div className="safety-footer-note"><Info size={18} /><p>This coursework prototype must not be used to publish real missing-person information until it has undergone appropriate security, privacy, operational and legal reviews. For real missing-person cases, contact SAPS immediately.</p></div><button className="button button-primary" onClick={() => navigate('home')}>Return to home <ArrowRight size={16} /></button></section>}
    </main>

    <footer className="site-footer"><div className="footer-main"><button className="brand footer-brand" onClick={() => navigate('home')}><span className="brand-mark"><UserRoundSearch size={22} /></span><span className="brand-words"><strong>MISSING PERSON</strong><small>ALERT</small></span></button><p>Connecting communities through responsible information sharing.</p><div className="footer-links"><button onClick={() => navigate('safety')}>Safety guidance</button><button onClick={() => navigate('alerts')}>Public alerts</button><button onClick={() => navigate('report')}>Submit a report</button></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Missing Person Alert · Student project prototype</span><span><ShieldCheck size={14} /> Not affiliated with or endorsed by SAPS</span></div></footer>
  </div>;
}

function LockIcon() { return <span className="lock-icon"><ShieldCheck size={27} /></span>; }
