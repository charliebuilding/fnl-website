import type { Context } from "@netlify/functions";
import jwt from "jsonwebtoken";
import { db } from "./vol-firebase.js";
import { sendVolunteerEmail, signupConfirmationEmail } from "./vol-email.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, PUT, DELETE, OPTIONS",
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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  if (req.method === "POST") return handleSignup(body, user);
  if (req.method === "PUT") return handleChangeRole(body, user);
  if (req.method === "DELETE") return handleCancel(body, user);

  return jsonResponse({ error: "Method not allowed" }, 405);
};

async function handleSignup(body: any, user: any) {
  const { eventId, roleId } = body;
  if (!eventId || !roleId) return jsonResponse({ error: "eventId and roleId required" }, 400);

  // Verify event exists and is open
  const eventDoc = await db.collection("volunteer-events").doc(eventId).get();
  if (!eventDoc.exists) return jsonResponse({ error: "Event not found" }, 404);
  const event = eventDoc.data()!;

  if (event.status !== "open" && event.status !== "active") {
    return jsonResponse({ error: "This event is not accepting signups" }, 400);
  }

  // Verify role exists
  const role = event.roles?.find((r: any) => r.id === roleId);
  if (!role) return jsonResponse({ error: "Role not found" }, 404);

  // Check if already signed up
  const signupId = `${eventId}_${user.volunteerId}`;
  const existingDoc = await db.collection("volunteer-signups").doc(signupId).get();
  if (existingDoc.exists) {
    const existing = existingDoc.data()!;
    if (existing.status !== "cancelled" && existing.status !== "declined") {
      return jsonResponse({ error: "You are already signed up for this event" }, 409);
    }
  }

  // Check role capacity
  const roleSignups = await db.collection("volunteer-signups")
    .where("eventId", "==", eventId)
    .where("roleId", "==", roleId)
    .where("status", "in", ["pending", "confirmed"])
    .get();

  if (roleSignups.size >= role.maxSlots) {
    return jsonResponse({ error: "This role is full" }, 400);
  }

  // Get volunteer details for denormalization
  const volDoc = await db.collection("volunteers").doc(user.volunteerId).get();
  const vol = volDoc.data()!;

  const signup = {
    eventId,
    volunteerId: user.volunteerId,
    volunteerName: `${vol.firstName} ${vol.lastName}`,
    volunteerEmail: vol.email,
    roleId,
    status: event.autoConfirm ? "confirmed" : "pending",
    checkedIn: false,
    checkedInAt: null,
    checkedInBy: null,
    hoursLogged: null,
    feedback: null,
    signedUpAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await db.collection("volunteer-signups").doc(signupId).set(signup);

  // Send confirmation email (fire and forget)
  const email = signupConfirmationEmail(
    signup.volunteerName,
    event.name,
    event.date,
    role.name,
    signup.status as "pending" | "confirmed",
    event.briefingTime,
    event.briefingLocation
  );
  sendVolunteerEmail(signup.volunteerEmail, email.subject, email.body).catch(() => {});

  return jsonResponse({
    signup: { id: signupId, ...signup },
    roleName: role.name,
  }, 201);
}

async function handleChangeRole(body: any, user: any) {
  const { eventId, roleId } = body;
  if (!eventId || !roleId) return jsonResponse({ error: "eventId and roleId required" }, 400);

  const signupId = `${eventId}_${user.volunteerId}`;
  const signupDoc = await db.collection("volunteer-signups").doc(signupId).get();
  if (!signupDoc.exists) return jsonResponse({ error: "Signup not found" }, 404);

  const signup = signupDoc.data()!;
  if (signup.status === "cancelled" || signup.status === "declined") {
    return jsonResponse({ error: "Cannot change role for a cancelled signup" }, 400);
  }

  // Check new role capacity
  const eventDoc = await db.collection("volunteer-events").doc(eventId).get();
  const event = eventDoc.data()!;
  const role = event.roles?.find((r: any) => r.id === roleId);
  if (!role) return jsonResponse({ error: "Role not found" }, 404);

  const roleSignups = await db.collection("volunteer-signups")
    .where("eventId", "==", eventId)
    .where("roleId", "==", roleId)
    .where("status", "in", ["pending", "confirmed"])
    .get();

  if (roleSignups.size >= role.maxSlots) {
    return jsonResponse({ error: "This role is full" }, 400);
  }

  await db.collection("volunteer-signups").doc(signupId).update({
    roleId,
    updatedAt: new Date().toISOString(),
  });

  return jsonResponse({ success: true, roleName: role.name });
}

async function handleCancel(body: any, user: any) {
  const { eventId } = body;
  if (!eventId) return jsonResponse({ error: "eventId required" }, 400);

  const signupId = `${eventId}_${user.volunteerId}`;
  const signupDoc = await db.collection("volunteer-signups").doc(signupId).get();
  if (!signupDoc.exists) return jsonResponse({ error: "Signup not found" }, 404);

  await db.collection("volunteer-signups").doc(signupId).update({
    status: "cancelled",
    updatedAt: new Date().toISOString(),
  });

  return jsonResponse({ success: true });
}

export const config = {
  path: "/api/volunteers/signup",
};
