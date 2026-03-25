// Volunteer auth — JWT session management
const SESSION_KEY = "fnl_vol_session";

export function getSession() {
  const token = localStorage.getItem(SESSION_KEY);
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (payload.exp * 1000 < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return payload;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function getToken() {
  return localStorage.getItem(SESSION_KEY);
}

export function setToken(token) {
  localStorage.setItem(SESSION_KEY, token);
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
  window.location.href = "/volunteers/";
}

export function requireAuth() {
  const session = getSession();
  if (!session) {
    window.location.href = "/volunteers/";
    return null;
  }
  return session;
}

export function requireAdmin() {
  const session = requireAuth();
  if (session && session.role !== "admin") {
    window.location.href = "/volunteers/dashboard.html";
    return null;
  }
  return session;
}

export function isAdmin() {
  const session = getSession();
  return session?.role === "admin";
}
