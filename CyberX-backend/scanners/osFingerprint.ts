// CyberX-backend/scanners/osFingerprint.ts
import { exec } from "child_process";

export async function osFingerprint(target: string): Promise<any> {
  return new Promise((resolve, reject) => {
    // Using Nmap for OS fingerprinting
    const cmd = `nmap -O ${target}`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(stderr || "OS fingerprinting failed"));
      }

      // Parse nmap output
      const osMatch = stdout.match(/OS details:\s*(.*)/i);
      const osGuess = stdout.match(/Aggressive OS guesses:\s*(.*)/i);

      resolve({
        raw: stdout,
        osDetails: osMatch ? osMatch[1] : null,
        osGuesses: osGuess ? osGuess[1].split(",") : [],
      });
    });
  });
}
