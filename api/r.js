// Serverless Function on Vercel (Node 18+)
export default async function handler(req, res) {
  try {
    const { to: toRaw, mc_eid, e } = req.query;
    if (!toRaw) return res.status(400).send("Missing ?to");

    let destStr = toRaw;
    try { destStr = decodeURIComponent(toRaw); } catch {}
    let dest;
    try { dest = new URL(destStr); } catch { return res.status(400).send("Bad ?to URL"); }

    // Only score if URL contains "barrie"
    const isBarrie = dest.href.toLowerCase().includes("barrie");

    const api = async (path, init = {}) => {
      const auth = Buffer.from(`anystring:${process.env.MC_API_KEY}`).toString("base64");
      const headers = { "Authorization": `Basic ${auth}`, "Content-Type": "application/json", ...(init.headers || {}) };
      const resp = await fetch(`https://${process.env.MC_DC}.api.mailchimp.com/3.0${path}`, { ...init, headers });
      if (!resp.ok) throw new Error(`${resp.status} ${await resp.text()}`);
      return resp.json();
    };

    // Find the subscriber in Mailchimp
    let memberId = null;
    if (mc_eid) {
      try {
        const q = await api(`/lists/${process.env.MC_LIST_ID}/members?unique_email_id=${encodeURIComponent(mc_eid)}&fields=members.id,total_items&count=1`);
        if (q.total_items > 0) memberId = q.members[0].id; // MD5 hash id
      } catch {}
    }
    if (!memberId && e) {
      try {
        const q = await api(`/search-members?list_id=${process.env.MC_LIST_ID}&query=${encodeURIComponent(e)}&fields=exact_matches.members.id,exact_matches.total_items`);
        if (q.exact_matches?.total_items > 0) memberId = q.exact_matches.members[0].id;
      } catch {}
    }

    // Increment the numeric merge field (e.g., BARRIE)
    if (isBarrie && memberId) {
      try {
        const fields = await api(`/lists/${process.env.MC_LIST_ID}/members/${memberId}?fields=merge_fields`);
        const current = parseInt(fields.merge_fields?.[process.env.SCORE_FIELD] ?? 0, 10) || 0;
        await api(`/lists/${process.env.MC_LIST_ID}/members/${memberId}`, {
          method: "PATCH",
          body: JSON.stringify({ merge_fields: { [process.env.SCORE_FIELD]: current + 1 } })
        });
      } catch {}
    }

    // Strip identifiers before redirect
    dest.searchParams.delete("mc_eid");
    dest.searchParams.delete("mc_cid");
    dest.searchParams.delete("e");

    res.writeHead(302, { Location: dest.toString() });
    res.end();
  } catch {
    const fallback = req.query.to || "/";
    res.writeHead(302, { Location: fallback });
    res.end();
  }
}
