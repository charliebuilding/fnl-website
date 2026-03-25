// Shared utilities for volunteer platform

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatTime(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

export function formatDateTime(isoStr) {
  const d = new Date(isoStr);
  return `${formatDate(isoStr)} at ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export function showToast(message, type = "success") {
  const existing = document.querySelector(".vol-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = `vol-toast vol-toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("vol-toast--visible"));
  setTimeout(() => {
    toast.classList.remove("vol-toast--visible");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

export function showLoading(container) {
  container.innerHTML = '<div class="vol-loader"><div class="vol-loader__spinner"></div></div>';
}

export function roleCategory(category) {
  const colors = {
    marshal: "var(--fnl-cyan)",
    "water-station": "#00CCAA",
    registration: "var(--fnl-magenta)",
    "finish-line": "var(--fnl-yellow)",
    medical: "#FF4488",
    logistics: "#8888AA",
    photographer: "var(--fnl-yellow)",
    other: "#AAAAAA",
  };
  return colors[category] || colors.other;
}

export function statusBadge(status) {
  const map = {
    pending: { label: "Pending", color: "var(--fnl-yellow)" },
    confirmed: { label: "Confirmed", color: "var(--fnl-cyan)" },
    declined: { label: "Declined", color: "var(--fnl-magenta)" },
    cancelled: { label: "Cancelled", color: "#666" },
  };
  const s = map[status] || map.pending;
  return `<span class="vol-badge" style="--badge-color: ${s.color}">${s.label}</span>`;
}
