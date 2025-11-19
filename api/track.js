// /api/track.js (Node 18 on Vercel)
export default async function handler(req, res) {
  try {
    const { to: toRaw, mc_eid, e, selling } = req.query; // selling = "yes" | "no" | undefined
    if (!toRaw) return res.status(400).send("Missing ?to");

    // --- Decode and validate destination URL ---
    let destStr = toRaw;
    try { destStr = decodeURIComponent(toRaw); } catch {}
    let dest;
    try { dest = new URL(destStr); } catch {
      return res.status(400).send("Bad ?to URL");
    }

    const isBarrie = dest.href.toLowerCase().includes("barrie");

    // --- Mailchimp helper ---
    const api = async (path, init = {}) => {
      const auth = Buffer.from(`anystring:${process.env.MC_API_KEY}`).toString("base64");
      const headers = {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
        ...(init.headers || {})
      };
      const resp = await fetch(
        `https://${process.env.MC_DC}.api.mailchimp.com/3.0${path}`,
        { ...init, headers }
      );
      if (!resp.ok) {
        throw new Error(`${resp.status} ${await resp.text()}`);
      }
      return resp.json();
    };

    // --- Find subscriber in Mailchimp ---
    let memberId = null;

    // 1) via mc_eid (Mailchimp unique id)
    if (mc_eid) {
      try {
        const q = await api(
          `/lists/${process.env.MC_LIST_ID}/members` +
          `?unique_email_id=${encodeURIComponent(mc_eid)}` +
          `&fields=members.id,total_items&count=1`
        );
        if (q.total_items > 0) memberId = q.members[0].id;
      } catch (err) {
        console.error("mc_eid lookup failed:", err.message);
      }
    }

    // 2) fallback via email
    if (!memberId && e) {
      try {
        const q = await api(
          `/search-members?list_id=${process.env.MC_LIST_ID}` +
          `&query=${encodeURIComponent(e)}` +
          `&fields=exact_matches.members.id,exact_matches.total_items`
        );
        if (q.exact_matches?.total_items > 0) {
          memberId = q.exact_matches.members[0].id;
        }
      } catch (err) {
        console.error("email lookup failed:", err.message);
      }
    }

    // --- Existing scoring logic (optional) ---
    if (isBarrie && memberId && process.env.SCORE_FIELD) {
      try {
        const fields = await api(
          `/lists/${process.env.MC_LIST_ID}/members/${memberId}?fields=merge_fields`
        );
        const current = parseInt(
          fields.merge_fields?.[process.env.SCORE_FIELD] ?? 0,
          10
        ) || 0;
        await api(`/lists/${process.env.MC_LIST_ID}/members/${memberId}`, {
          method: "PATCH",
          body: JSON.stringify({
            merge_fields: { [process.env.SCORE_FIELD]: current + 1 }
          })
        });
      } catch (err) {
        console.error("score update failed:", err.message);
      }
    }

    // --- NEW: one-click Selling 2026 Yes/No tagging ---
    if (selling && memberId) {
      // Normalise just in case
      const value = String(selling).toLowerCase();
      let tagName = null;

      if (value === "yes") tagName = "Selling 2026 - Yes";
      else if (value === "no") tagName = "Selling 2026 - No";

      if (tagName) {
        try {
          await api(
            `/lists/${process.env.MC_LIST_ID}/members/${memberId}/tags`,
            {
              method: "POST",
              body: JSON.stringify({
                tags: [{ name: tagName, status: "active" }]
              })
            }
          );
        } catch (err) {
          console.error("tag update failed:", err.message);
        }
      }
    }

    // Strip identifiers before redirect
    dest.searchParams.delete("mc_eid");
    dest.searchParams.delete("mc_cid");
    dest.searchParams.delete("e");
    dest.searchParams.delete("selling");

    res.writeHead(302, { Location: dest.toString() });
    res.end();
  } catch (err) {
    console.error("handler error:", err.message);
    const fallback = req.query.to || "/";
    res.writeHead(302, { Location: fallback });
    res.end();
  }
}
