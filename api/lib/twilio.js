// Twilio SMS helper — dependency-free (plain fetch against the Twilio REST API).
// Requires env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER

export async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !authToken || !from) {
    console.error("sendSms: Twilio env vars not configured, skipping send");
    return { ok: false, error: "SMS not configured" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: from, Body: body });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${authToken}`).toString("base64"),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Twilio send error:", res.status, errText);
    return { ok: false, error: "Failed to send SMS" };
  }

  const data = await res.json();
  return { ok: true, sid: data.sid };
}
