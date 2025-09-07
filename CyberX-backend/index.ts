import express from "express";
import cors from "cors";
import scanRouter from "./routes/scan";
import osFingerprintRouter from "./routes/osfingerprint";
import serviceDetectionRouter from "./routes/serviceDetection";
import subdomainEnumRouter from "./routes/subdomainEnum";
import whoisRouter from "./routes/whois";
import dnsReconRouter from "./routes/dnsRecon";
import reverseIPRouter from "./routes/reverseIP";
import ipGeolocationRouter from "./routes/ipGeolocation";
import dirFuzzerRouter from "./routes/dirFuzzer";
import vulnFuzzerRouter from "./routes/vulnFuzzer";
import apiScannerRouter from "./routes/apiScanner";
import brokenAuthRouter from "./routes/brokenAuth";

const app = express();
const PORT = process.env.PORT || 8787;

// ✅ Enable CORS for all origins (dev-friendly)
app.use(cors({ origin: "http://localhost:5173" }));

// ✅ Parse JSON requests
app.use(express.json());

// ✅ Routes
app.use("/api/scan", scanRouter);
app.use("/api/osfingerprint", osFingerprintRouter);
app.use("/api/service-detect", serviceDetectionRouter);
app.use("/api/subdomains", subdomainEnumRouter);
app.use("/api/whois", whoisRouter);
app.use("/api/dnsrecon", dnsReconRouter);
app.use("/api/reverse-ip", reverseIPRouter);
app.use("/api/ip-geolocation", ipGeolocationRouter);
app.use("/api/dir-fuzzer", dirFuzzerRouter);
app.use("/api/vuln-fuzzer", vulnFuzzerRouter);
app.use("/api/api-scanner", apiScannerRouter);
app.use("/api/broken-auth", brokenAuthRouter);

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
