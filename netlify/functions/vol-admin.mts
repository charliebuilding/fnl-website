import type { Context } from "@netlify/functions";
import jwt from "jsonwebtoken";
import { db } from "./vol-firebase.js";
import { sendVolunteerEmail, confirmationEmail } from "./vol-email.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(data: object, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

function verifyAdmin(req: Request): any {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const decoded: any = jwt.verify(auth.slice(7), Netlify.env.get("JWT_SECRET")!);
    if (decoded.role !== "admin") return null;
    return decoded;
  } catch {
    return null;
  }
}

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const user = verifyAdmin(req);
  if (!user) return jsonResponse({ error: "Admin access required" }, 403);

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";

  if (req.method === "GET") {
    switch (action) {
      case "volunteers": return getVolunteers();
      case "signups": return getSignups(url.searchParams.get("eventId") || "");
      case "stats": return getStats(url.searchParams.get("eventId") || "");
      case "export": return exportCsv(url.searchParams.get("eventId") || "");
      default: return jsonResponse({ error: "Invalid action" }, 400);
    }
  }

  if (req.method === "PUT") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    switch (body.action) {
      case "update-signup": return updateSignup(body);
      case "update-volunteer": return updateVolunteer(body);
      case "log-hours": return logHours(body);
      default: return jsonResponse({ error: "Invalid action" }, 400);
    }
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
};

async function getVolunteers() {
  const snapshot = await db.collection("volunteers").orderBy("createdAt", "desc").get();
  const volunteers = snapshot.docs.map(d => {
    const data = d.data();
    const { passwordHash, ...safe } = data;
    return { id: d.id, ...safe };
  });
  return jsonResponse({ volunteers });
}

async function getSignups(eventId: string) {
  if (!eventId) return jsonResponse({ error: "eventId required" }, 400);

  const snapshot = await db.collection("volunteer-signups")
    .where("eventId", "==", eventId)
    .get();

  // Get event for role names
  const eventDoc = await db.collection("volunteer-events").doc(eventId).get();
  const event = eventDoc.exists ? eventDoc.data() : null;
  const roleMap: Record<string, string> = {};
  if (event?.roles) {
    event.roles.forEach((r: any) => { roleMap[r.id] = r.name; });
  }

  const signups = snapshot.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      roleName: roleMap[data.roleId] || data.roleId,
    };
  });

  return jsonResponse({ signups });
}

async function updateSignup(body: any) {
  const { signupId, status } = body;
  if (!signupId || !status) return jsonResponse({ error: "signupId and status required" }, 400);

  const validStatuses = ["pending", "confirmed", "declined"];
  if (!validStatuses.includes(status)) {
    return jsonResponse({ error: "Invalid status" }, 400);
  }

  const ref = db.collection("volunteer-signups").doc(signupId);
  const doc = await ref.get();
  if (!doc.exists) return jsonResponse({ error: "Signup not found" }, 404);

  const signup = doc.data()!;
  await ref.update({ status, updatedAt: new Date().toISOString() });

  // Send confirmation email when admin confirms a volunteer
  if (status === "confirmed" && signup.status !== "confirmed") {
    const eventDoc = await db.collection("volunteer-events").doc(signup.eventId).get();
    const event = eventDoc.exists ? eventDoc.data()! : null;
    const role = event?.roles?.find((r: any) => r.id === signup.roleId);

    if (event && role) {
      const email = confirmationEmail(
        signup.volunteerName,
        event.name,
        event.date,
        role.name,
        event.briefingTime,
        event.briefingLocation
      );
      sendVolunteerEmail(signup.volunteerEmail, email.subject, email.body).catch(() => {});
    }
  }

  return jsonResponse({ success: true });
}

async function updateVolunteer(body: any) {
  const { volunteerId, role, notes } = body;
  if (!volunteerId) return jsonResponse({ error: "volunteerId required" }, 400);

  const ref = db.collection("volunteers").doc(volunteerId);
  const doc = await ref.get();
  if (!doc.exists) return jsonResponse({ error: "Volunteer not found" }, 404);

  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (role) updates.role = role;
  if (notes !== undefined) updates.notes = notes;

  await ref.update(updates);
  return jsonResponse({ success: true });
}

async function logHours(body: any) {
  const { signupId, hours } = body;
  if (!signupId || hours === undefined) return jsonResponse({ error: "signupId and hours required" }, 400);

  const ref = db.collection("volunteer-signups").doc(signupId);
  const doc = await ref.get();
  if (!doc.exists) return jsonResponse({ error: "Signup not found" }, 404);
  const signup = doc.data()!;

  // Update signup
  await ref.update({ hoursLogged: hours, updatedAt: new Date().toISOString() });

  // Update volunteer totals
  const volRef = db.collection("volunteers").doc(signup.volunteerId);
  const volDoc = await volRef.get();
  if (volDoc.exists) {
    const vol = volDoc.data()!;
    // Recalculate totals from all signups
    const allSignups = await db.collection("volunteer-signups")
      .where("volunteerId", "==", signup.volunteerId)
      .where("checkedIn", "==", true)
      .get();

    let totalHours = 0;
    let eventsCompleted = 0;
    allSignups.docs.forEach(s => {
      const sd = s.data();
      if (sd.hoursLogged) totalHours += sd.hoursLogged;
      eventsCompleted++;
    });

    // Include the current update if checked in
    if (signup.checkedIn && !allSignups.docs.some(s => s.id === signupId)) {
      totalHours += hours;
      eventsCompleted++;
    }

    await volRef.update({ totalHours, eventsCompleted, updatedAt: new Date().toISOString() });
  }

  return jsonResponse({ success: true });
}

async function getStats(eventId: string) {
  if (!eventId) return jsonResponse({ error: "eventId required" }, 400);

  const eventDoc = await db.collection("volunteer-events").doc(eventId).get();
  if (!eventDoc.exists) return jsonResponse({ error: "Event not found" }, 404);
  const event = eventDoc.data()!;

  const signups = await db.collection("volunteer-signups")
    .where("eventId", "==", eventId)
    .get();

  let total = 0, confirmed = 0, pending = 0, checkedIn = 0;
  const roleCounts: Record<string, { filled: number; max: number; name: string }> = {};

  // Init role counts
  (event.roles || []).forEach((r: any) => {
    roleCounts[r.id] = { filled: 0, max: r.maxSlots, name: r.name };
  });

  signups.docs.forEach(d => {
    const s = d.data();
    if (s.status === "cancelled" || s.status === "declined") return;
    total++;
    if (s.status === "confirmed") confirmed++;
    if (s.status === "pending") pending++;
    if (s.checkedIn) checkedIn++;
    if (roleCounts[s.roleId]) roleCounts[s.roleId].filled++;
  });

  return jsonResponse({
    stats: { total, confirmed, pending, checkedIn, maxVolunteers: event.maxVolunteers },
    roleCounts,
  });
}

async function exportCsv(eventId: string) {
  if (!eventId) return jsonResponse({ error: "eventId required" }, 400);

  const eventDoc = await db.collection("volunteer-events").doc(eventId).get();
  if (!eventDoc.exists) return jsonResponse({ error: "Event not found" }, 404);
  const event = eventDoc.data()!;

  const roleMap: Record<string, string> = {};
  (event.roles || []).forEach((r: any) => { roleMap[r.id] = r.name; });

  const signups = await db.collection("volunteer-signups")
    .where("eventId", "==", eventId)
    .get();

  const rows = [["Name", "Email", "Role", "Status", "Checked In", "Hours"].join(",")];
  signups.docs.forEach(d => {
    const s = d.data();
    rows.push([
      `"${s.volunteerName}"`,
      `"${s.volunteerEmail}"`,
      `"${roleMap[s.roleId] || s.roleId}"`,
      s.status,
      s.checkedIn ? "Yes" : "No",
      s.hoursLogged ?? "",
    ].join(","));
  });

  return new Response(rows.join("\n"), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${eventId}-volunteers.csv"`,
    },
  });
}

export const config = {
  path: "/api/volunteers/admin",
};
