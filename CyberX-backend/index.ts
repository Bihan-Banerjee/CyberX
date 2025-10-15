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
import bucketFinderRouter from "./routes/bucketFinder";
import containerScannerRouter from "./routes/containerScanner";
import k8sEnumRouter from "./routes/k8sEnum";
import hashRouter from "./routes/hash";
import cryptoRouter from "./routes/crypto";
import jwtDecodeRouter from "./routes/jwtDecode";
import stegoRouter from "./routes/stegoImage";
import stegoAudioRouter from "./routes/stegoAudio";
import stegoExtractRouter from "./routes/stegoExtract";
import imageMetaRouter from "./routes/imageMeta";
import emailBreachRoutes from "./routes/emailBreach";
import googleDorkRouter from "./routes/googleDork";
import packetAnalyzerRouter from "./routes/packetAnalyzer";
import honeypotRouter from './routes/honeypot';

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
app.use("/api/bucket-finder", bucketFinderRouter);
app.use("/api/container-scan", containerScannerRouter);
app.use("/api/k8s-enum", k8sEnumRouter);
app.use("/api/hash", hashRouter);
app.use("/api/crypto", cryptoRouter);
app.use("/api/jwt-decode", jwtDecodeRouter);
app.use("/api/stego-image", stegoRouter);
app.use("/api/stego-audio", stegoAudioRouter);
app.use("/api/stego-extract", stegoExtractRouter);
app.use("/api/image-meta", imageMetaRouter);
app.use("/api/emailbreach", emailBreachRoutes);
app.use("/api/google-dork", googleDorkRouter);
app.use("/api/packet-analyzer", packetAnalyzerRouter);
app.use('/api/honeypot', honeypotRouter); 

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
