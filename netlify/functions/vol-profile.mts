import type { Context } from "@netlify/functions";
import jwt from "jsonwebtoken";
import { db } from "./vol-firebase.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
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

  const user = verifyToken(req);
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

  if (req.method === "GET") {
    const doc = await db.collection("volunteers").doc(user.volunteerId).get();
    if (!doc.exists) return jsonResponse({ error: "Profile not found" }, 404);
    const data = doc.data()!;
    const { passwordHash, ...safe } = data;

    // Also get signup history
    const signups = await db.collection("volunteer-signups")
      .where("volunteerId", "==", user.volunteerId)
      .get();

    const history = [];
    for (const s of signups.docs) {
      const sd = s.data();
      const eventDoc = await db.collection("volunteer-events").doc(sd.eventId).get();
      const eventData = eventDoc.exists ? eventDoc.data() : null;
      const role = eventData?.roles?.find((r: any) => r.id === sd.roleId);
      history.push({
        id: s.id,
        eventId: sd.eventId,
        eventName: eventData?.name || sd.eventId,
        eventDate: eventData?.date || "",
        roleName: role?.name || sd.roleId,
        status: sd.status,
        checkedIn: sd.checkedIn,
        hoursLogged: sd.hoursLogged,
      });
    }

    return jsonResponse({ volunteer: { id: doc.id, ...safe }, history });
  }

  if (req.method === "PUT") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const allowed = ["firstName", "lastName", "phone", "emergencyName", "emergencyPhone", "tshirtSize", "skills"];
    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    updates.updatedAt = new Date().toISOString();

    await db.collection("volunteers").doc(user.volunteerId).update(updates);

    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
};

export const config = {
  path: "/api/volunteers/profile",
};
