import { Router } from "express";
import axios from "axios";
import qs from "qs";

const router = Router();

const defaultCreds = [
  { username: "admin", password: "admin" },
  { username: "admin", password: "password" },
  { username: "root", password: "root" },
  { username: "test", password: "test" },
];

router.post("/", async (req, res) => {
  try {
    const { loginUrl, protectedUrl, creds = defaultCreds } = req.body;

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
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        "User-Agent": "Mozilla/5.0 (CyberX Security Scanner)",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      withCredentials: true,
    });

    // 1️⃣ Direct Access Bypass Test
    if (protectedUrl) {
      try {
        const resp = await instance.get(protectedUrl);
        results.directAccess =
          resp.status < 300
            ? "⚠️ Protected resource accessible without auth"
            : "✅ Access correctly denied";
      } catch {
        results.directAccess = "ℹ️ Unable to test direct access";
      }
    } else {
      results.directAccess = "ℹ️ No protected URL provided";
    }

    // 2️⃣ Default Credentials Test
    let weakCredsFound = false;
    for (const { username, password } of creds) {
      const payloads = [
        qs.stringify({ username, password }),
        qs.stringify({ email: username, password }),
        qs.stringify({ user: username, pass: password }),
      ];

      for (const payload of payloads) {
        try {
          const resp = await instance.post(loginUrl, payload);
          if (
            resp.status === 200 &&
            (/token|session/i.test(JSON.stringify(resp.data)) ||
              resp.headers["set-cookie"])
          ) {
            results.defaultCreds.push({
              username,
              password,
              status: "❌ Weak credentials accepted",
            });
            weakCredsFound = true;
            break;
          }
        } catch (err: any) {
          results.defaultCreds.push({
            username,
            password,
            status: `⚠️ Error: ${err.message}`,
          });
        }
      }
      if (weakCredsFound) break;
    }
    if (!weakCredsFound) {
      results.defaultCreds.push({ status: "✅ Default creds rejected" });
    }

    // 3️⃣ Session Management Check
    try {
      const attempt = await instance.post(
        loginUrl,
        qs.stringify(creds[0])
      );
      results.sessionManagement =
        attempt.headers["set-cookie"] || attempt.data.token
          ? "✅ Session token/cookie issued"
          : "⚠️ No session token or cookie detected";
    } catch {
      results.sessionManagement = "ℹ️ Session check skipped";
    }

    // 4️⃣ HTTP Method Validation
    try {
      const wrongMethod = await instance.get(loginUrl);
      results.methodCheck =
        wrongMethod.status < 300
          ? "⚠️ Login allows GET — possible bypass"
          : "✅ Login correctly restricts methods";
    } catch {
      results.methodCheck = "ℹ️ Method check skipped";
    }

    // 5️⃣ Open Redirect Check
    try {
      const loginAttempt = await instance.post(
        loginUrl,
        qs.stringify(creds[0])
      );
      if (
        loginAttempt.request.res &&
        loginAttempt.request.res.responseUrl &&
        loginAttempt.request.res.responseUrl !== loginUrl
      ) {
        results.redirectBehavior = `⚠️ Unexpected redirect to ${loginAttempt.request.res.responseUrl}`;
      } else {
        results.redirectBehavior = "✅ No insecure redirects detected";
      }
    } catch {
      results.redirectBehavior = "ℹ️ Redirect check skipped";
    }

    res.json({ success: true, results });
  } catch (e: any) {
    console.error("brokenAuth error:", e);
    res.status(500).json({ error: e?.message || "Broken Auth detection failed" });
  }
});

export default router;
