// API client — all fetch calls to volunteer Netlify Functions
import { getToken, logout } from "./vol-auth.js";

const BASE = "/api/volunteers";

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    logout();
    return null;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// Auth
export async function register(fields) {
  return request("/auth", {
    method: "POST",
    body: JSON.stringify({ action: "register", ...fields }),
  });
}

export async function login(email, password) {
  return request("/auth", {
    method: "POST",
    body: JSON.stringify({ action: "login", email, password }),
  });
}

export async function forgotPassword(email) {
  return request("/auth", {
    method: "POST",
    body: JSON.stringify({ action: "forgot-password", email }),
  });
}

export async function resetPassword(token, password) {
  return request("/auth", {
    method: "POST",
    body: JSON.stringify({ action: "reset-password", token, password }),
  });
}

// Events
export async function getEvents() {
  return request("/events");
}

export async function getEvent(eventId) {
  return request(`/events?id=${eventId}`);
}

export async function createEvent(event) {
  return request("/events", {
    method: "POST",
    body: JSON.stringify(event),
  });
}

export async function updateEvent(eventId, updates) {
  return request("/events", {
    method: "PUT",
    body: JSON.stringify({ id: eventId, ...updates }),
  });
}

// Signups
export async function signUp(eventId, roleId) {
  return request("/signup", {
    method: "POST",
    body: JSON.stringify({ eventId, roleId }),
  });
}

export async function cancelSignup(eventId) {
  return request("/signup", {
    method: "DELETE",
    body: JSON.stringify({ eventId }),
  });
}

export async function changeRole(eventId, roleId) {
  return request("/signup", {
    method: "PUT",
    body: JSON.stringify({ eventId, roleId }),
  });
}

// Profile
export async function getProfile() {
  return request("/profile");
}

export async function updateProfile(updates) {
  return request("/profile", {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

// Admin
export async function adminGetVolunteers() {
  return request("/admin?action=volunteers");
}

export async function adminGetSignups(eventId) {
  return request(`/admin?action=signups&eventId=${eventId}`);
}

export async function adminUpdateSignup(signupId, updates) {
  return request("/admin", {
    method: "PUT",
    body: JSON.stringify({ action: "update-signup", signupId, ...updates }),
  });
}

export async function adminUpdateVolunteer(volunteerId, updates) {
  return request("/admin", {
    method: "PUT",
    body: JSON.stringify({ action: "update-volunteer", volunteerId, ...updates }),
  });
}

export async function adminLogHours(signupId, hours) {
  return request("/admin", {
    method: "PUT",
    body: JSON.stringify({ action: "log-hours", signupId, hours }),
  });
}

export async function adminGetStats(eventId) {
  return request(`/admin?action=stats&eventId=${eventId}`);
}

export async function adminExportCsv(eventId) {
  return request(`/admin?action=export&eventId=${eventId}`);
}

// Check-in
export async function checkIn(eventId, volunteerId) {
  return request("/checkin", {
    method: "POST",
    body: JSON.stringify({ eventId, volunteerId }),
  });
}

// Communications
export async function sendComms(data) {
  return request("/comms", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getCommsHistory(eventId) {
  return request(`/comms?eventId=${eventId || ""}`);
}
