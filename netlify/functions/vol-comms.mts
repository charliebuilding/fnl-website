import type { Context } from "@netlify/functions";
import jwt from "jsonwebtoken";
import { db } from "./vol-firebase.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function buildHtmlEmail(subject: string, body: string): string {
  // Convert line breaks to paragraphs
  const paragraphs = body.split("\n").filter(Boolean).map(p => `<p style="margin:0 0 12px 0;line-height:1.6">${p}</p>`).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px">
    <div style="text-align:center;margin-bottom:32px">
      <span style="font-family:'Courier New',monospace;font-weight:800;font-size:20px;color:#00FFD1;letter-spacing:2px">FNL VOLUNTEERS</span>
    </div>
    <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:32px 24px;color:#FFFFFF;font-size:15px">
      <h2 style="margin:0 0 20px 0;font-size:20px;font-weight:600;color:#FFFFFF">${subject}</h2>
      ${paragraphs}
    </div>
    <div style="text-align:center;margin-top:24px;color:#666;font-size:12px">
      <p>Friday Night Lights &mdash; The UK's Healthiest Night Out</p>
      <p style="margin-top:8px">You're receiving this because you're registered as an FNL volunteer.</p>
    </div>
  </div>
</body>
</html>`;
}

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const user = verifyAdmin(req);
  if (!user) return jsonResponse({ error: "Admin access required" }, 403);

  if (req.method === "GET") {
    return handleGetHistory(req);
  }

  if (req.method === "POST") {
    return handleSend(req, user);
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
};

async function handleGetHistory(req: Request) {
  const url = new URL(req.url);
  const eventId = url.searchParams.get("eventId");

  let query = db.collection("volunteer-comms").orderBy("sentAt", "desc").limit(50);
  if (eventId) {
    query = db.collection("volunteer-comms")
      .where("eventId", "==", eventId)
      .orderBy("sentAt", "desc")
      .limit(50);
  }

  const snapshot = await query.get();
  const comms = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  return jsonResponse({ comms });
}

async function handleSend(req: Request, user: any) {
  const resendKey = Netlify.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return jsonResponse({ error: "Email service not configured. Set RESEND_API_KEY in Netlify env vars." }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { subject, body: messageBody, filter } = body;
  if (!subject || !messageBody) {
    return jsonResponse({ error: "Subject and body are required" }, 400);
  }

  // Resolve recipient emails based on filter
  let emails: string[] = [];
  let eventId: string | null = null;

  if (filter === "all") {
    const snapshot = await db.collection("volunteers").get();
    emails = snapshot.docs.map(d => d.data().email).filter(Boolean);
  } else if (filter?.startsWith("event:")) {
    eventId = filter.replace("event:", "");
    const signups = await db.collection("volunteer-signups")
      .where("eventId", "==", eventId)
      .where("status", "in", ["pending", "confirmed"])
      .get();
    emails = signups.docs.map(d => d.data().volunteerEmail).filter(Boolean);
  }

  if (emails.length === 0) {
    return jsonResponse({ error: "No recipients found for this filter" }, 400);
  }

  // Deduplicate
  emails = [...new Set(emails)];

  const htmlBody = buildHtmlEmail(subject, messageBody);

  // Send via Resend — batch in groups of 50 (Resend limit per call)
  const fromAddress = Netlify.env.get("VOLUNTEER_FROM_EMAIL") || "FNL Volunteers <team@fridaynightlights.run>";
  let sentCount = 0;
  const batchSize = 50;

  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: fromAddress, // Send to self
        bcc: batch,      // BCC all recipients for privacy
        subject,
        html: htmlBody,
      }),
    });

    if (res.ok) {
      sentCount += batch.length;
    } else {
      const err = await res.json();
      console.error("Resend error:", err);
    }
  }

  // Log the communication
  await db.collection("volunteer-comms").add({
    eventId,
    subject,
    body: messageBody,
    sentBy: user.volunteerId,
    recipientCount: sentCount,
    recipientFilter: filter,
    sentAt: new Date().toISOString(),
  });

  return jsonResponse({
    success: true,
    sentCount,
    totalRecipients: emails.length,
  });
}

export const config = {
  path: "/api/volunteers/comms",
};
