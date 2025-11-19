// api/track.js
export default async function handler(req, res) {
  try {
    const { to: rawTo, selling, e } = req.query;
    if (!rawTo) return res.status(400).send("Missing ?to");

    // Decode redirect URL
    let toUrl = rawTo;
    try { toUrl = decodeURIComponent(rawTo); } catch {}
    let dest;
    try { dest = new URL(toUrl); }
    catch { return res.status(400).send("Invalid redirect URL"); }

    // Mailchimp helper
    const api = async (path, init = {}) => {
      const auth = Buffer.from(`anystring:${process.env.MC_API_KEY}`).toString("base64");
      const headers = {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json"
      };
      const response = await fetch(
        `https://${process.env.MC_DC}.api.mailchimp.com/3.0${path}`,
        { ...init, headers }
      );
      return response.ok ? response.json() : null;
    };

    // Apply tag if selling=yes/no & email present
    if (selling && e) {
      const email = e.trim().toLowerCase();

      // Member ID = MD5 of lowercase email
      const crypto = await import("crypto");
      const memberId = crypto.createHash("md5").update(email).digest("hex");

      let tagName = null;
      if (selling.toLowerCase() === "yes") tagName = "Selling 2026 - Yes";
      if (selling.toLowerCase() === "no") tagName = "Selling 2026 - No";

      if (tagName) {
        await api(
          `/lists/${process.env.MC_LIST_ID}/members/${memberId}/tags`,
          {
            method: "POST",
            body: JSON.stringify({
              tags: [{ name: tagName, status: "active" }]
            })
          }
        );
      }
    }

    // Redirect
    res.writeHead(302, { Location: dest.toString() });
    res.end();

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
}
