import type { Context } from "@netlify/functions";
import jwt from "jsonwebtoken";
import { db } from "./vol-firebase.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(data: object, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

function verifyToken(req: Request): any {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(auth.slice(7), Netlify.env.get("JWT_SECRET")!);
  } catch {
    return null;
  }
}

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method === "GET") {
    return handleGet(req);
  }

  const user = verifyToken(req);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

  if (req.method === "POST") {
    if (user.role !== "admin") return jsonResponse({ error: "Admin only" }, 403);
    return handleCreate(req, user);
  }

  if (req.method === "PUT") {
    if (user.role !== "admin") return jsonResponse({ error: "Admin only" }, 403);
    return handleUpdate(req, user);
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
};

async function handleGet(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const doc = await db.collection("volunteer-events").doc(id).get();
    if (!doc.exists) return jsonResponse({ error: "Event not found" }, 404);

    // Get signup counts per role
    const signups = await db.collection("volunteer-signups")
      .where("eventId", "==", id)
      .where("status", "in", ["pending", "confirmed"])
      .get();

    const roleCounts: Record<string, number> = {};
    signups.docs.forEach(s => {
      const d = s.data();
      roleCounts[d.roleId] = (roleCounts[d.roleId] || 0) + 1;
    });

    return jsonResponse({
      event: { id: doc.id, ...doc.data(), roleCounts },
    });
  }

  // List all events
  const snapshot = await db.collection("volunteer-events")
    .orderBy("date", "asc")
    .get();

  const events = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  return jsonResponse({ events });
}

async function handleCreate(req: Request, user: any) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { name, date, time, location, maxVolunteers, briefingTime, briefingLocation, roles, autoConfirm } = body;

  if (!name || !date || !location) {
    return jsonResponse({ error: "Name, date and location are required" }, 400);
  }

  const eventId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const eventRef = db.collection("volunteer-events").doc(eventId);

  const existing = await eventRef.get();
  if (existing.exists) {
    return jsonResponse({ error: "An event with this ID already exists" }, 409);
  }

  const event = {
    name,
    date,
    time: time || "",
    location,
    maxVolunteers: maxVolunteers || 80,
    status: "draft",
    briefingTime: briefingTime || "",
    briefingLocation: briefingLocation || "",
    autoConfirm: autoConfirm || false,
    roles: (roles || []).map((r: any, i: number) => ({
      id: r.id || `role-${i}`,
      name: r.name || "Unnamed Role",
      category: r.category || "other",
      description: r.description || "",
      maxSlots: r.maxSlots || 4,
      shiftStart: r.shiftStart || "",
      shiftEnd: r.shiftEnd || "",
      requiresSkill: r.requiresSkill || null,
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await eventRef.set(event);

  return jsonResponse({ event: { id: eventId, ...event } }, 201);
}

async function handleUpdate(req: Request, user: any) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { id, ...updates } = body;
  if (!id) return jsonResponse({ error: "Event ID required" }, 400);

  const eventRef = db.collection("volunteer-events").doc(id);
  const doc = await eventRef.get();
  if (!doc.exists) return jsonResponse({ error: "Event not found" }, 404);

  updates.updatedAt = new Date().toISOString();
  await eventRef.update(updates);

  const updated = await eventRef.get();
  return jsonResponse({ event: { id: updated.id, ...updated.data() } });
}

export const config = {
  path: "/api/volunteers/events",
};
