import type { Context } from "@netlify/functions";
import jwt from "jsonwebtoken";
import { db } from "./vol-firebase.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(data: object, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Verify admin
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

  let user: any;
  try {
    user = jwt.verify(auth.slice(7), Netlify.env.get("JWT_SECRET")!);
  } catch {
    return jsonResponse({ error: "Invalid token" }, 401);
  }

  if (user.role !== "admin") {
    return jsonResponse({ error: "Admin access required" }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { eventId, volunteerId } = body;
  if (!eventId || !volunteerId) {
    return jsonResponse({ error: "eventId and volunteerId required" }, 400);
  }

  const signupId = `${eventId}_${volunteerId}`;
  const ref = db.collection("volunteer-signups").doc(signupId);
  const doc = await ref.get();

  if (!doc.exists) {
    return jsonResponse({ error: "Signup not found" }, 404);
  }

  const signup = doc.data()!;

  if (signup.checkedIn) {
    return jsonResponse({ error: "Already checked in", checkedInAt: signup.checkedInAt }, 409);
  }

  await ref.update({
    checkedIn: true,
    checkedInAt: new Date().toISOString(),
    checkedInBy: user.volunteerId,
    status: "confirmed", // auto-confirm on check-in if still pending
    updatedAt: new Date().toISOString(),
  });

  return jsonResponse({
    success: true,
    volunteerName: signup.volunteerName,
    checkedInAt: new Date().toISOString(),
  });
};

export const config = {
  path: "/api/volunteers/checkin",
};
