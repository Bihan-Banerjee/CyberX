import { Router } from "express";
import axios from "axios";

const router = Router();

// Default weak creds list for testing
const defaultCreds = [
  { username: "admin", password: "admin" },
  { username: "admin", password: "password" },
  { username: "root", password: "root" },
  { username: "test", password: "test" },
];

router.post("/", async (req, res) => {
  try {
    const {
      loginUrl,
      protectedUrl, // optional, used to test access control
      creds = defaultCreds,
    } = req.body;

    if (!loginUrl) {
      return res.status(400).json({ error: "Login URL is required" });
    }

    const results: any = {
      loginUrl,
      protectedUrl,
      directAccess: null,
      defaultCreds: [],
      sessionManagement: null,
      methodCheck: null,
      redirectBehavior: null,
    };

    const instance = axios.create({
      timeout: 7000,
      validateStatus: () => true,
      withCredentials: true,
    });

    // 1️⃣ Direct Access Bypass
    if (protectedUrl) {
      const resp = await instance.get(protectedUrl);
      results.directAccess =
        resp.status < 300
          ? "⚠️ Protected resource accessible without auth"
          : "✅ Access correctly denied";
    } else {
      results.directAccess = "ℹ️ No protected URL provided";
    }

    // 2️⃣ Default Credentials
    for (const { username, password } of creds) {
      try {
        const resp = await instance.post(loginUrl, { username, password });
        if (resp.status < 300 && /token|session/i.test(JSON.stringify(resp.data))) {
          results.defaultCreds.push({
            username,
            password,
            status: "❌ Weak credentials accepted",
          });
          break;
        }
      } catch {
        // Ignore errors
      }
    }
    if (results.defaultCreds.length === 0) {
      results.defaultCreds.push({ status: "✅ Default creds rejected" });
    }

    // 3️⃣ Session Management
    const loginAttempt = await instance.post(loginUrl, creds[0]);
    if (!loginAttempt.headers["set-cookie"] && !loginAttempt.data.token) {
      results.sessionManagement = "⚠️ No session cookie or token detected";
    } else {
      results.sessionManagement = "✅ Session token/cookie correctly issued";
    }

    // 4️⃣ Improper HTTP Method Check
    const wrongMethod = await instance.get(loginUrl);
    results.methodCheck =
      wrongMethod.status < 300
        ? "⚠️ Login allows GET — possible bypass"
        : "✅ Login correctly restricts methods";

    // 5️⃣ Open Redirect Check
    if (loginAttempt.request.res.responseUrl !== loginUrl) {
      results.redirectBehavior = `⚠️ Unexpected redirect to ${loginAttempt.request.res.responseUrl}`;
    } else {
      results.redirectBehavior = "✅ No insecure redirects detected";
    }

    res.json({ success: true, results });
  } catch (e: any) {
    console.error("brokenAuth error:", e);
    res.status(500).json({ error: e?.message || "Broken Auth detection failed" });
  }
});

export default router;
