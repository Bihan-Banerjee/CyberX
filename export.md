# Project Structure

```
CyberX-backend/
  routes/
    scan.ts
  scanners/
    portScanner.ts
  .gitignore
  index.ts
  package-lock.json
  package.json
  server.js
  tsconfig.json
CyberX-frontend/
  public/
    full_logo.jpg
    half_logo.jpg
    vite.svg
  src/
    assets/
      react.svg
    components/
      layout/
        Layout.tsx
      ui/
        navbar-menu.tsx
      CyberpunkCard.tsx
      WebGLBackground.tsx
    data/
      navigation.ts
    lib/
      utils.ts
    pages/
      AIEngine.tsx
      Dashboard.tsx
      DefensiveTools.tsx
      Home.tsx
      Honeypots.tsx
      OffensiveTools.tsx
      PortScanner.tsx
      Settings.tsx
      Simulations.tsx
      Tools.tsx
      Visualization.tsx
    routes/
      app-router.tsx
    types/
      index.ts
    App.css
    App.tsx
    index.css
    main.tsx
    vite-env.d.ts
  .gitignore
  components.json
  eslint.config.js
  index.html
  package-lock.json
  package.json
  README.md
  tailwind.config.js
  tsconfig.app.json
  tsconfig.json
  tsconfig.node.json
  vite.config.ts
.gitignore
export.md
```



# Selected Files Content

## CyberX-backend/routes/scan.ts

```ts
// src/server/routes/scan.ts
import { Router } from 'express';
import { portScan, parsePorts } from '../scanners/portScanner';

const router = Router();

router.post('/scan', async (req, res) => {
  try {
    const { target, ports, tcp = true, udp = false, timeoutMs = 1200, concurrency = 200, retries = 2 } = req.body || {};
    if (!target || !ports) return res.status(400).json({ error: 'target and ports are required' });

    const portList = parsePorts(String(ports));
    const results = await portScan({
      target,
      ports: portList,
      tcp: Boolean(tcp),
      udp: Boolean(udp),
      timeoutMs: Math.max(200, Number(timeoutMs) || 1200),
      concurrency: Math.max(1, Number(concurrency) || 200),
      retries: Math.max(1, Number(retries) || 2),
    });

    res.json({ target, count: results.length, results });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'scan failed' });
  }
});

export default router;
```

## CyberX-backend/scanners/portScanner.ts

```ts
// src/server/scanners/portScanner.ts
import net from 'node:net';
import dgram from 'node:dgram';

export type ScanResult = {
  port: number;
  protocol: 'tcp' | 'udp';
  state: 'open' | 'closed' | 'filtered' | 'open|filtered';
  reason: string;
  latencyMs: number | null;
};

export function parsePorts(ports: string): number[] {
  const out = new Set<number>();
  for (const part of ports.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map((n) => parseInt(n, 10));
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      for (let p = start; p <= end; p++) out.add(p);
    } else {
      out.add(parseInt(part, 10));
    }
  }
  return [...out]
    .filter((p) => Number.isFinite(p) && p > 0 && p < 65536)
    .sort((a, b) => a - b);
}

/**
 * TCP connect scan: succeeds on TCP handshake ("connect"), closed on ECONNREFUSED (RST), filtered on timeout/unreachables. 
 */
async function scanTcpPort(
  host: string,
  port: number,
  timeoutMs: number
): Promise<ScanResult> {
  const start = Date.now();
  return new Promise<ScanResult>((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (state: ScanResult['state'], reason: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        port,
        protocol: 'tcp',
        state,
        reason,
        latencyMs: Date.now() - start,
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => done('filtered', 'timeout'));
    socket.once('connect', () => done('open', 'tcp connect ok'));
    socket.once('error', (err: any) => {
      if (err?.code === 'ECONNREFUSED') done('closed', 'rst/econnrefused');
      else if (
        err?.code === 'EHOSTUNREACH' ||
        err?.code === 'ENETUNREACH' ||
        err?.code === 'ETIMEDOUT'
      )
        done('filtered', String(err.code).toLowerCase());
      else done('filtered', err?.code || 'error');
    });

    socket.connect(port, host);
  });
}

/**
 * UDP probe: reply => open, ICMP port unreachable => closed (often surfaces as ECONNREFUSED), else open|filtered after retries. 
 */
async function scanUdpPort(
  host: string,
  port: number,
  timeoutMs: number,
  retries: number
): Promise<ScanResult> {
  const start = Date.now();
  return new Promise<ScanResult>((resolve) => {
    const sock = dgram.createSocket('udp4');
    let responded = false;
    let attempts = 0;
    const payload = Buffer.alloc(0); // generic probe

    const finish = (state: ScanResult['state'], reason: string) => {
      try {
        sock.close();
      } catch {}
      resolve({
        port,
        protocol: 'udp',
        state,
        reason,
        latencyMs: responded ? Date.now() - start : null,
      });
    };

    sock.once('message', () => {
      responded = true;
      finish('open', 'udp reply');
    });

    sock.on('error', (err: any) => {
      if (err?.code === 'ECONNREFUSED') finish('closed', 'icmp port unreachable');
      else finish('filtered', err?.code || 'udp error');
    });

    const trySend = () => {
      attempts++;
      try {
        sock.send(payload, port, host, () => {
          setTimeout(() => {
            if (responded) return;
            if (attempts < retries) trySend();
            else finish('open|filtered', 'no response');
          }, timeoutMs);
        });
      } catch (e: any) {
        finish('filtered', e?.code || 'send error');
      }
    };

    trySend();
  });
}

export async function portScan(params: {
  target: string;
  ports: number[];
  tcp: boolean;
  udp: boolean;
  timeoutMs: number;
  concurrency: number;
  retries: number; // udp retries
}): Promise<ScanResult[]> {
  // Attach metadata to each task to avoid any/undefined indexing issues.
  type Task = {
    run: () => Promise<ScanResult>;
    meta: { port: number; protocol: 'tcp' | 'udp' };
  };
  const tasks: Task[] = [];

  for (const p of params.ports) {
    if (params.tcp)
      tasks.push({
        run: () => scanTcpPort(params.target, p, params.timeoutMs),
        meta: { port: p, protocol: 'tcp' },
      });
    if (params.udp)
      tasks.push({
        run: () => scanUdpPort(params.target, p, params.timeoutMs, params.retries),
        meta: { port: p, protocol: 'udp' },
      });
  }

  const results: ScanResult[] = [];
  let i = 0;

  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      const task = tasks[idx]!; // guarded by i < tasks.length, safe to assert
      try {
        const r = await task.run();
        results.push(r);
      } catch (e: any) {
        results.push({
          port: task.meta.port,
          protocol: task.meta.protocol,
          state: 'filtered',
          reason: e?.message || 'error',
          latencyMs: null,
        });
      }
    }
  }

  const poolSize = Math.max(1, params.concurrency);
  await Promise.all(new Array(poolSize).fill(0).map(() => worker()));

  results.sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));
  return results;
}
```

## CyberX-backend/.gitignore

```
# Python
__pycache__/
*.pyc
venv/
.env

# Node
node_modules/
dist/
.vscode/

# Logs
*.log
data/logs/
```

## CyberX-backend/index.ts

```ts
import express from 'express';
import scanRouter from './routes/scan.js';

const app = express();
app.use(express.json());            // parse JSON bodies
app.use('/api', scanRouter);        // POST /api/scan

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
```

## CyberX-backend/package-lock.json

```json
{
  "name": "cyberx-backend",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "cyberx-backend",
      "version": "1.0.0",
      "license": "ISC",
      "dependencies": {
        "express": "^5.1.0"
      },
      "devDependencies": {
        "@types/express": "^5.0.3",
        "@types/node": "^24.3.1",
        "tsx": "^4.20.5",
        "typescript": "^5.9.2"
      }
    },
    "node_modules/@esbuild/aix-ppc64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/aix-ppc64/-/aix-ppc64-0.25.9.tgz",
      "integrity": "sha512-OaGtL73Jck6pBKjNIe24BnFE6agGl+6KxDtTfHhy1HmhthfKouEcOhqpSL64K4/0WCtbKFLOdzD/44cJ4k9opA==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "aix"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/android-arm": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/android-arm/-/android-arm-0.25.9.tgz",
      "integrity": "sha512-5WNI1DaMtxQ7t7B6xa572XMXpHAaI/9Hnhk8lcxF4zVN4xstUgTlvuGDorBguKEnZO70qwEcLpfifMLoxiPqHQ==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/android-arm64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/android-arm64/-/android-arm64-0.25.9.tgz",
      "integrity": "sha512-IDrddSmpSv51ftWslJMvl3Q2ZT98fUSL2/rlUXuVqRXHCs5EUF1/f+jbjF5+NG9UffUDMCiTyh8iec7u8RlTLg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/android-x64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/android-x64/-/android-x64-0.25.9.tgz",
      "integrity": "sha512-I853iMZ1hWZdNllhVZKm34f4wErd4lMyeV7BLzEExGEIZYsOzqDWDf+y082izYUE8gtJnYHdeDpN/6tUdwvfiw==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/darwin-arm64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/darwin-arm64/-/darwin-arm64-0.25.9.tgz",
      "integrity": "sha512-XIpIDMAjOELi/9PB30vEbVMs3GV1v2zkkPnuyRRURbhqjyzIINwj+nbQATh4H9GxUgH1kFsEyQMxwiLFKUS6Rg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/darwin-x64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/darwin-x64/-/darwin-x64-0.25.9.tgz",
      "integrity": "sha512-jhHfBzjYTA1IQu8VyrjCX4ApJDnH+ez+IYVEoJHeqJm9VhG9Dh2BYaJritkYK3vMaXrf7Ogr/0MQ8/MeIefsPQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/freebsd-arm64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/freebsd-arm64/-/freebsd-arm64-0.25.9.tgz",
      "integrity": "sha512-z93DmbnY6fX9+KdD4Ue/H6sYs+bhFQJNCPZsi4XWJoYblUqT06MQUdBCpcSfuiN72AbqeBFu5LVQTjfXDE2A6Q==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/freebsd-x64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/freebsd-x64/-/freebsd-x64-0.25.9.tgz",
      "integrity": "sha512-mrKX6H/vOyo5v71YfXWJxLVxgy1kyt1MQaD8wZJgJfG4gq4DpQGpgTB74e5yBeQdyMTbgxp0YtNj7NuHN0PoZg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-arm": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-arm/-/linux-arm-0.25.9.tgz",
      "integrity": "sha512-HBU2Xv78SMgaydBmdor38lg8YDnFKSARg1Q6AT0/y2ezUAKiZvc211RDFHlEZRFNRVhcMamiToo7bDx3VEOYQw==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-arm64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-arm64/-/linux-arm64-0.25.9.tgz",
      "integrity": "sha512-BlB7bIcLT3G26urh5Dmse7fiLmLXnRlopw4s8DalgZ8ef79Jj4aUcYbk90g8iCa2467HX8SAIidbL7gsqXHdRw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-ia32": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-ia32/-/linux-ia32-0.25.9.tgz",
      "integrity": "sha512-e7S3MOJPZGp2QW6AK6+Ly81rC7oOSerQ+P8L0ta4FhVi+/j/v2yZzx5CqqDaWjtPFfYz21Vi1S0auHrap3Ma3A==",
      "cpu": [
        "ia32"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-loong64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-loong64/-/linux-loong64-0.25.9.tgz",
      "integrity": "sha512-Sbe10Bnn0oUAB2AalYztvGcK+o6YFFA/9829PhOCUS9vkJElXGdphz0A3DbMdP8gmKkqPmPcMJmJOrI3VYB1JQ==",
      "cpu": [
        "loong64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-mips64el": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-mips64el/-/linux-mips64el-0.25.9.tgz",
      "integrity": "sha512-YcM5br0mVyZw2jcQeLIkhWtKPeVfAerES5PvOzaDxVtIyZ2NUBZKNLjC5z3/fUlDgT6w89VsxP2qzNipOaaDyA==",
      "cpu": [
        "mips64el"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-ppc64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-ppc64/-/linux-ppc64-0.25.9.tgz",
      "integrity": "sha512-++0HQvasdo20JytyDpFvQtNrEsAgNG2CY1CLMwGXfFTKGBGQT3bOeLSYE2l1fYdvML5KUuwn9Z8L1EWe2tzs1w==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-riscv64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-riscv64/-/linux-riscv64-0.25.9.tgz",
      "integrity": "sha512-uNIBa279Y3fkjV+2cUjx36xkx7eSjb8IvnL01eXUKXez/CBHNRw5ekCGMPM0BcmqBxBcdgUWuUXmVWwm4CH9kg==",
      "cpu": [
        "riscv64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-s390x": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-s390x/-/linux-s390x-0.25.9.tgz",
      "integrity": "sha512-Mfiphvp3MjC/lctb+7D287Xw1DGzqJPb/J2aHHcHxflUo+8tmN/6d4k6I2yFR7BVo5/g7x2Monq4+Yew0EHRIA==",
      "cpu": [
        "s390x"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-x64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-x64/-/linux-x64-0.25.9.tgz",
      "integrity": "sha512-iSwByxzRe48YVkmpbgoxVzn76BXjlYFXC7NvLYq+b+kDjyyk30J0JY47DIn8z1MO3K0oSl9fZoRmZPQI4Hklzg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/netbsd-arm64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/netbsd-arm64/-/netbsd-arm64-0.25.9.tgz",
      "integrity": "sha512-9jNJl6FqaUG+COdQMjSCGW4QiMHH88xWbvZ+kRVblZsWrkXlABuGdFJ1E9L7HK+T0Yqd4akKNa/lO0+jDxQD4Q==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "netbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/netbsd-x64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/netbsd-x64/-/netbsd-x64-0.25.9.tgz",
      "integrity": "sha512-RLLdkflmqRG8KanPGOU7Rpg829ZHu8nFy5Pqdi9U01VYtG9Y0zOG6Vr2z4/S+/3zIyOxiK6cCeYNWOFR9QP87g==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "netbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/openbsd-arm64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/openbsd-arm64/-/openbsd-arm64-0.25.9.tgz",
      "integrity": "sha512-YaFBlPGeDasft5IIM+CQAhJAqS3St3nJzDEgsgFixcfZeyGPCd6eJBWzke5piZuZ7CtL656eOSYKk4Ls2C0FRQ==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/openbsd-x64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/openbsd-x64/-/openbsd-x64-0.25.9.tgz",
      "integrity": "sha512-1MkgTCuvMGWuqVtAvkpkXFmtL8XhWy+j4jaSO2wxfJtilVCi0ZE37b8uOdMItIHz4I6z1bWWtEX4CJwcKYLcuA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/openharmony-arm64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/openharmony-arm64/-/openharmony-arm64-0.25.9.tgz",
      "integrity": "sha512-4Xd0xNiMVXKh6Fa7HEJQbrpP3m3DDn43jKxMjxLLRjWnRsfxjORYJlXPO4JNcXtOyfajXorRKY9NkOpTHptErg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openharmony"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/sunos-x64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/sunos-x64/-/sunos-x64-0.25.9.tgz",
      "integrity": "sha512-WjH4s6hzo00nNezhp3wFIAfmGZ8U7KtrJNlFMRKxiI9mxEK1scOMAaa9i4crUtu+tBr+0IN6JCuAcSBJZfnphw==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "sunos"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/win32-arm64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/win32-arm64/-/win32-arm64-0.25.9.tgz",
      "integrity": "sha512-mGFrVJHmZiRqmP8xFOc6b84/7xa5y5YvR1x8djzXpJBSv/UsNK6aqec+6JDjConTgvvQefdGhFDAs2DLAds6gQ==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/win32-ia32": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/win32-ia32/-/win32-ia32-0.25.9.tgz",
      "integrity": "sha512-b33gLVU2k11nVx1OhX3C8QQP6UHQK4ZtN56oFWvVXvz2VkDoe6fbG8TOgHFxEvqeqohmRnIHe5A1+HADk4OQww==",
      "cpu": [
        "ia32"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/win32-x64": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-0.25.9.tgz",
      "integrity": "sha512-PPOl1mi6lpLNQxnGoyAfschAodRFYXJ+9fs6WHXz7CSWKbOqiMZsubC+BQsVKuul+3vKLuwTHsS2c2y9EoKwxQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@types/body-parser": {
      "version": "1.19.6",
      "resolved": "https://registry.npmjs.org/@types/body-parser/-/body-parser-1.19.6.tgz",
      "integrity": "sha512-HLFeCYgz89uk22N5Qg3dvGvsv46B8GLvKKo1zKG4NybA8U2DiEO3w9lqGg29t/tfLRJpJ6iQxnVw4OnB7MoM9g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/connect": "*",
        "@types/node": "*"
      }
    },
    "node_modules/@types/connect": {
      "version": "3.4.38",
      "resolved": "https://registry.npmjs.org/@types/connect/-/connect-3.4.38.tgz",
      "integrity": "sha512-K6uROf1LD88uDQqJCktA4yzL1YYAK6NgfsI0v/mTgyPKWsX1CnJ0XPSDhViejru1GcRkLWb8RlzFYJRqGUbaug==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/node": "*"
      }
    },
    "node_modules/@types/express": {
      "version": "5.0.3",
      "resolved": "https://registry.npmjs.org/@types/express/-/express-5.0.3.tgz",
      "integrity": "sha512-wGA0NX93b19/dZC1J18tKWVIYWyyF2ZjT9vin/NRu0qzzvfVzWjs04iq2rQ3H65vCTQYlRqs3YHfY7zjdV+9Kw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/body-parser": "*",
        "@types/express-serve-static-core": "^5.0.0",
        "@types/serve-static": "*"
      }
    },
    "node_modules/@types/express-serve-static-core": {
      "version": "5.0.7",
      "resolved": "https://registry.npmjs.org/@types/express-serve-static-core/-/express-serve-static-core-5.0.7.tgz",
      "integrity": "sha512-R+33OsgWw7rOhD1emjU7dzCDHucJrgJXMA5PYCzJxVil0dsyx5iBEPHqpPfiKNJQb7lZ1vxwoLR4Z87bBUpeGQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/node": "*",
        "@types/qs": "*",
        "@types/range-parser": "*",
        "@types/send": "*"
      }
    },
    "node_modules/@types/http-errors": {
      "version": "2.0.5",
      "resolved": "https://registry.npmjs.org/@types/http-errors/-/http-errors-2.0.5.tgz",
      "integrity": "sha512-r8Tayk8HJnX0FztbZN7oVqGccWgw98T/0neJphO91KkmOzug1KkofZURD4UaD5uH8AqcFLfdPErnBod0u71/qg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/mime": {
      "version": "1.3.5",
      "resolved": "https://registry.npmjs.org/@types/mime/-/mime-1.3.5.tgz",
      "integrity": "sha512-/pyBZWSLD2n0dcHE3hq8s8ZvcETHtEuF+3E7XVt0Ig2nvsVQXdghHVcEkIWjy9A0wKfTn97a/PSDYohKIlnP/w==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/node": {
      "version": "24.3.1",
      "resolved": "https://registry.npmjs.org/@types/node/-/node-24.3.1.tgz",
      "integrity": "sha512-3vXmQDXy+woz+gnrTvuvNrPzekOi+Ds0ReMxw0LzBiK3a+1k0kQn9f2NWk+lgD4rJehFUmYy2gMhJ2ZI+7YP9g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "undici-types": "~7.10.0"
      }
    },
    "node_modules/@types/qs": {
      "version": "6.14.0",
      "resolved": "https://registry.npmjs.org/@types/qs/-/qs-6.14.0.tgz",
      "integrity": "sha512-eOunJqu0K1923aExK6y8p6fsihYEn/BYuQ4g0CxAAgFc4b/ZLN4CrsRZ55srTdqoiLzU2B2evC+apEIxprEzkQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/range-parser": {
      "version": "1.2.7",
      "resolved": "https://registry.npmjs.org/@types/range-parser/-/range-parser-1.2.7.tgz",
      "integrity": "sha512-hKormJbkJqzQGhziax5PItDUTMAM9uE2XXQmM37dyd4hVM+5aVl7oVxMVUiVQn2oCQFN/LKCZdvSM0pFRqbSmQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/send": {
      "version": "0.17.5",
      "resolved": "https://registry.npmjs.org/@types/send/-/send-0.17.5.tgz",
      "integrity": "sha512-z6F2D3cOStZvuk2SaP6YrwkNO65iTZcwA2ZkSABegdkAh/lf+Aa/YQndZVfmEXT5vgAp6zv06VQ3ejSVjAny4w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/mime": "^1",
        "@types/node": "*"
      }
    },
    "node_modules/@types/serve-static": {
      "version": "1.15.8",
      "resolved": "https://registry.npmjs.org/@types/serve-static/-/serve-static-1.15.8.tgz",
      "integrity": "sha512-roei0UY3LhpOJvjbIP6ZZFngyLKl5dskOtDhxY5THRSpO+ZI+nzJ+m5yUMzGrp89YRa7lvknKkMYjqQFGwA7Sg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/http-errors": "*",
        "@types/node": "*",
        "@types/send": "*"
      }
    },
    "node_modules/accepts": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/accepts/-/accepts-2.0.0.tgz",
      "integrity": "sha512-5cvg6CtKwfgdmVqY1WIiXKc3Q1bkRqGLi+2W/6ao+6Y7gu/RCwRuAhGEzh5B4KlszSuTLgZYuqFqo5bImjNKng==",
      "license": "MIT",
      "dependencies": {
        "mime-types": "^3.0.0",
        "negotiator": "^1.0.0"
      },
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/body-parser": {
      "version": "2.2.0",
      "resolved": "https://registry.npmjs.org/body-parser/-/body-parser-2.2.0.tgz",
      "integrity": "sha512-02qvAaxv8tp7fBa/mw1ga98OGm+eCbqzJOKoRt70sLmfEEi+jyBYVTDGfCL/k06/4EMk/z01gCe7HoCH/f2LTg==",
      "license": "MIT",
      "dependencies": {
        "bytes": "^3.1.2",
        "content-type": "^1.0.5",
        "debug": "^4.4.0",
        "http-errors": "^2.0.0",
        "iconv-lite": "^0.6.3",
        "on-finished": "^2.4.1",
        "qs": "^6.14.0",
        "raw-body": "^3.0.0",
        "type-is": "^2.0.0"
      },
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/bytes": {
      "version": "3.1.2",
      "resolved": "https://registry.npmjs.org/bytes/-/bytes-3.1.2.tgz",
      "integrity": "sha512-/Nf7TyzTx6S3yRJObOAV7956r8cr2+Oj8AC5dt8wSP3BQAoeX58NoHyCU8P8zGkNXStjTSi6fzO6F0pBdcYbEg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/call-bind-apply-helpers": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/call-bind-apply-helpers/-/call-bind-apply-helpers-1.0.2.tgz",
      "integrity": "sha512-Sp1ablJ0ivDkSzjcaJdxEunN5/XvksFJ2sMBFfq6x0ryhQV/2b/KwFe21cMpmHtPOSij8K99/wSfoEuTObmuMQ==",
      "license": "MIT",
      "dependencies": {
        "es-errors": "^1.3.0",
        "function-bind": "^1.1.2"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/call-bound": {
      "version": "1.0.4",
      "resolved": "https://registry.npmjs.org/call-bound/-/call-bound-1.0.4.tgz",
      "integrity": "sha512-+ys997U96po4Kx/ABpBCqhA9EuxJaQWDQg7295H4hBphv3IZg0boBKuwYpt4YXp6MZ5AmZQnU/tyMTlRpaSejg==",
      "license": "MIT",
      "dependencies": {
        "call-bind-apply-helpers": "^1.0.2",
        "get-intrinsic": "^1.3.0"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/content-disposition": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/content-disposition/-/content-disposition-1.0.0.tgz",
      "integrity": "sha512-Au9nRL8VNUut/XSzbQA38+M78dzP4D+eqg3gfJHMIHHYa3bg067xj1KxMUWj+VULbiZMowKngFFbKczUrNJ1mg==",
      "license": "MIT",
      "dependencies": {
        "safe-buffer": "5.2.1"
      },
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/content-type": {
      "version": "1.0.5",
      "resolved": "https://registry.npmjs.org/content-type/-/content-type-1.0.5.tgz",
      "integrity": "sha512-nTjqfcBFEipKdXCv4YDQWCfmcLZKm81ldF0pAopTvyrFGVbcR6P/VAAd5G7N+0tTr8QqiU0tFadD6FK4NtJwOA==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/cookie": {
      "version": "0.7.2",
      "resolved": "https://registry.npmjs.org/cookie/-/cookie-0.7.2.tgz",
      "integrity": "sha512-yki5XnKuf750l50uGTllt6kKILY4nQ1eNIQatoXEByZ5dWgnKqbnqmTrBE5B4N7lrMJKQ2ytWMiTO2o0v6Ew/w==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/cookie-signature": {
      "version": "1.2.2",
      "resolved": "https://registry.npmjs.org/cookie-signature/-/cookie-signature-1.2.2.tgz",
      "integrity": "sha512-D76uU73ulSXrD1UXF4KE2TMxVVwhsnCgfAyTg9k8P6KGZjlXKrOLe4dJQKI3Bxi5wjesZoFXJWElNWBjPZMbhg==",
      "license": "MIT",
      "engines": {
        "node": ">=6.6.0"
      }
    },
    "node_modules/debug": {
      "version": "4.4.1",
      "resolved": "https://registry.npmjs.org/debug/-/debug-4.4.1.tgz",
      "integrity": "sha512-KcKCqiftBJcZr++7ykoDIEwSa3XWowTfNPo92BYxjXiyYEVrUQh2aLyhxBCwww+heortUFxEJYcRzosstTEBYQ==",
      "license": "MIT",
      "dependencies": {
        "ms": "^2.1.3"
      },
      "engines": {
        "node": ">=6.0"
      },
      "peerDependenciesMeta": {
        "supports-color": {
          "optional": true
        }
      }
    },
    "node_modules/depd": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/depd/-/depd-2.0.0.tgz",
      "integrity": "sha512-g7nH6P6dyDioJogAAGprGpCtVImJhpPk/roCzdb3fIh61/s/nPsfR6onyMwkCAR/OlC3yBC0lESvUoQEAssIrw==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/dunder-proto": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/dunder-proto/-/dunder-proto-1.0.1.tgz",
      "integrity": "sha512-KIN/nDJBQRcXw0MLVhZE9iQHmG68qAVIBg9CqmUYjmQIhgij9U5MFvrqkUL5FbtyyzZuOeOt0zdeRe4UY7ct+A==",
      "license": "MIT",
      "dependencies": {
        "call-bind-apply-helpers": "^1.0.1",
        "es-errors": "^1.3.0",
        "gopd": "^1.2.0"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/ee-first": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/ee-first/-/ee-first-1.1.1.tgz",
      "integrity": "sha512-WMwm9LhRUo+WUaRN+vRuETqG89IgZphVSNkdFgeb6sS/E4OrDIN7t48CAewSHXc6C8lefD8KKfr5vY61brQlow==",
      "license": "MIT"
    },
    "node_modules/encodeurl": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/encodeurl/-/encodeurl-2.0.0.tgz",
      "integrity": "sha512-Q0n9HRi4m6JuGIV1eFlmvJB7ZEVxu93IrMyiMsGC0lrMJMWzRgx6WGquyfQgZVb31vhGgXnfmPNNXmxnOkRBrg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/es-define-property": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/es-define-property/-/es-define-property-1.0.1.tgz",
      "integrity": "sha512-e3nRfgfUZ4rNGL232gUgX06QNyyez04KdjFrF+LTRoOXmrOgFKDg4BCdsjW8EnT69eqdYGmRpJwiPVYNrCaW3g==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/es-errors": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/es-errors/-/es-errors-1.3.0.tgz",
      "integrity": "sha512-Zf5H2Kxt2xjTvbJvP2ZWLEICxA6j+hAmMzIlypy4xcBg1vKVnx89Wy0GbS+kf5cwCVFFzdCFh2XSCFNULS6csw==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/es-object-atoms": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/es-object-atoms/-/es-object-atoms-1.1.1.tgz",
      "integrity": "sha512-FGgH2h8zKNim9ljj7dankFPcICIK9Cp5bm+c2gQSYePhpaG5+esrLODihIorn+Pe6FGJzWhXQotPv73jTaldXA==",
      "license": "MIT",
      "dependencies": {
        "es-errors": "^1.3.0"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/esbuild": {
      "version": "0.25.9",
      "resolved": "https://registry.npmjs.org/esbuild/-/esbuild-0.25.9.tgz",
      "integrity": "sha512-CRbODhYyQx3qp7ZEwzxOk4JBqmD/seJrzPa/cGjY1VtIn5E09Oi9/dB4JwctnfZ8Q8iT7rioVv5k/FNT/uf54g==",
      "dev": true,
      "hasInstallScript": true,
      "license": "MIT",
      "bin": {
        "esbuild": "bin/esbuild"
      },
      "engines": {
        "node": ">=18"
      },
      "optionalDependencies": {
        "@esbuild/aix-ppc64": "0.25.9",
        "@esbuild/android-arm": "0.25.9",
        "@esbuild/android-arm64": "0.25.9",
        "@esbuild/android-x64": "0.25.9",
        "@esbuild/darwin-arm64": "0.25.9",
        "@esbuild/darwin-x64": "0.25.9",
        "@esbuild/freebsd-arm64": "0.25.9",
        "@esbuild/freebsd-x64": "0.25.9",
        "@esbuild/linux-arm": "0.25.9",
        "@esbuild/linux-arm64": "0.25.9",
        "@esbuild/linux-ia32": "0.25.9",
        "@esbuild/linux-loong64": "0.25.9",
        "@esbuild/linux-mips64el": "0.25.9",
        "@esbuild/linux-ppc64": "0.25.9",
        "@esbuild/linux-riscv64": "0.25.9",
        "@esbuild/linux-s390x": "0.25.9",
        "@esbuild/linux-x64": "0.25.9",
        "@esbuild/netbsd-arm64": "0.25.9",
        "@esbuild/netbsd-x64": "0.25.9",
        "@esbuild/openbsd-arm64": "0.25.9",
        "@esbuild/openbsd-x64": "0.25.9",
        "@esbuild/openharmony-arm64": "0.25.9",
        "@esbuild/sunos-x64": "0.25.9",
        "@esbuild/win32-arm64": "0.25.9",
        "@esbuild/win32-ia32": "0.25.9",
        "@esbuild/win32-x64": "0.25.9"
      }
    },
    "node_modules/escape-html": {
      "version": "1.0.3",
      "resolved": "https://registry.npmjs.org/escape-html/-/escape-html-1.0.3.tgz",
      "integrity": "sha512-NiSupZ4OeuGwr68lGIeym/ksIZMJodUGOSCZ/FSnTxcrekbvqrgdUxlJOMpijaKZVjAJrWrGs/6Jy8OMuyj9ow==",
      "license": "MIT"
    },
    "node_modules/etag": {
      "version": "1.8.1",
      "resolved": "https://registry.npmjs.org/etag/-/etag-1.8.1.tgz",
      "integrity": "sha512-aIL5Fx7mawVa300al2BnEE4iNvo1qETxLrPI/o05L7z6go7fCw1J6EQmbK4FmJ2AS7kgVF/KEZWufBfdClMcPg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/express": {
      "version": "5.1.0",
      "resolved": "https://registry.npmjs.org/express/-/express-5.1.0.tgz",
      "integrity": "sha512-DT9ck5YIRU+8GYzzU5kT3eHGA5iL+1Zd0EutOmTE9Dtk+Tvuzd23VBU+ec7HPNSTxXYO55gPV/hq4pSBJDjFpA==",
      "license": "MIT",
      "dependencies": {
        "accepts": "^2.0.0",
        "body-parser": "^2.2.0",
        "content-disposition": "^1.0.0",
        "content-type": "^1.0.5",
        "cookie": "^0.7.1",
        "cookie-signature": "^1.2.1",
        "debug": "^4.4.0",
        "encodeurl": "^2.0.0",
        "escape-html": "^1.0.3",
        "etag": "^1.8.1",
        "finalhandler": "^2.1.0",
        "fresh": "^2.0.0",
        "http-errors": "^2.0.0",
        "merge-descriptors": "^2.0.0",
        "mime-types": "^3.0.0",
        "on-finished": "^2.4.1",
        "once": "^1.4.0",
        "parseurl": "^1.3.3",
        "proxy-addr": "^2.0.7",
        "qs": "^6.14.0",
        "range-parser": "^1.2.1",
        "router": "^2.2.0",
        "send": "^1.1.0",
        "serve-static": "^2.2.0",
        "statuses": "^2.0.1",
        "type-is": "^2.0.1",
        "vary": "^1.1.2"
      },
      "engines": {
        "node": ">= 18"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/finalhandler": {
      "version": "2.1.0",
      "resolved": "https://registry.npmjs.org/finalhandler/-/finalhandler-2.1.0.tgz",
      "integrity": "sha512-/t88Ty3d5JWQbWYgaOGCCYfXRwV1+be02WqYYlL6h0lEiUAMPM8o8qKGO01YIkOHzka2up08wvgYD0mDiI+q3Q==",
      "license": "MIT",
      "dependencies": {
        "debug": "^4.4.0",
        "encodeurl": "^2.0.0",
        "escape-html": "^1.0.3",
        "on-finished": "^2.4.1",
        "parseurl": "^1.3.3",
        "statuses": "^2.0.1"
      },
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/forwarded": {
      "version": "0.2.0",
      "resolved": "https://registry.npmjs.org/forwarded/-/forwarded-0.2.0.tgz",
      "integrity": "sha512-buRG0fpBtRHSTCOASe6hD258tEubFoRLb4ZNA6NxMVHNw2gOcwHo9wyablzMzOA5z9xA9L1KNjk/Nt6MT9aYow==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/fresh": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/fresh/-/fresh-2.0.0.tgz",
      "integrity": "sha512-Rx/WycZ60HOaqLKAi6cHRKKI7zxWbJ31MhntmtwMoaTeF7XFH9hhBp8vITaMidfljRQ6eYWCKkaTK+ykVJHP2A==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/fsevents": {
      "version": "2.3.3",
      "resolved": "https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz",
      "integrity": "sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==",
      "dev": true,
      "hasInstallScript": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": "^8.16.0 || ^10.6.0 || >=11.0.0"
      }
    },
    "node_modules/function-bind": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/function-bind/-/function-bind-1.1.2.tgz",
      "integrity": "sha512-7XHNxH7qX9xG5mIwxkhumTox/MIRNcOgDrxWsMt2pAr23WHp6MrRlN7FBSFpCpr+oVO0F744iUgR82nJMfG2SA==",
      "license": "MIT",
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/get-intrinsic": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/get-intrinsic/-/get-intrinsic-1.3.0.tgz",
      "integrity": "sha512-9fSjSaos/fRIVIp+xSJlE6lfwhES7LNtKaCBIamHsjr2na1BiABJPo0mOjjz8GJDURarmCPGqaiVg5mfjb98CQ==",
      "license": "MIT",
      "dependencies": {
        "call-bind-apply-helpers": "^1.0.2",
        "es-define-property": "^1.0.1",
        "es-errors": "^1.3.0",
        "es-object-atoms": "^1.1.1",
        "function-bind": "^1.1.2",
        "get-proto": "^1.0.1",
        "gopd": "^1.2.0",
        "has-symbols": "^1.1.0",
        "hasown": "^2.0.2",
        "math-intrinsics": "^1.1.0"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/get-proto": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/get-proto/-/get-proto-1.0.1.tgz",
      "integrity": "sha512-sTSfBjoXBp89JvIKIefqw7U2CCebsc74kiY6awiGogKtoSGbgjYE/G/+l9sF3MWFPNc9IcoOC4ODfKHfxFmp0g==",
      "license": "MIT",
      "dependencies": {
        "dunder-proto": "^1.0.1",
        "es-object-atoms": "^1.0.0"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/get-tsconfig": {
      "version": "4.10.1",
      "resolved": "https://registry.npmjs.org/get-tsconfig/-/get-tsconfig-4.10.1.tgz",
      "integrity": "sha512-auHyJ4AgMz7vgS8Hp3N6HXSmlMdUyhSUrfBF16w153rxtLIEOE+HGqaBppczZvnHLqQJfiHotCYpNhl0lUROFQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "resolve-pkg-maps": "^1.0.0"
      },
      "funding": {
        "url": "https://github.com/privatenumber/get-tsconfig?sponsor=1"
      }
    },
    "node_modules/gopd": {
      "version": "1.2.0",
      "resolved": "https://registry.npmjs.org/gopd/-/gopd-1.2.0.tgz",
      "integrity": "sha512-ZUKRh6/kUFoAiTAtTYPZJ3hw9wNxx+BIBOijnlG9PnrJsCcSjs1wyyD6vJpaYtgnzDrKYRSqf3OO6Rfa93xsRg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/has-symbols": {
      "version": "1.1.0",
      "resolved": "https://registry.npmjs.org/has-symbols/-/has-symbols-1.1.0.tgz",
      "integrity": "sha512-1cDNdwJ2Jaohmb3sg4OmKaMBwuC48sYni5HUw2DvsC8LjGTLK9h+eb1X6RyuOHe4hT0ULCW68iomhjUoKUqlPQ==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/hasown": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/hasown/-/hasown-2.0.2.tgz",
      "integrity": "sha512-0hJU9SCPvmMzIBdZFqNPXWa6dqh7WdH0cII9y+CyS8rG3nL48Bclra9HmKhVVUHyPWNH5Y7xDwAB7bfgSjkUMQ==",
      "license": "MIT",
      "dependencies": {
        "function-bind": "^1.1.2"
      },
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/http-errors": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/http-errors/-/http-errors-2.0.0.tgz",
      "integrity": "sha512-FtwrG/euBzaEjYeRqOgly7G0qviiXoJWnvEH2Z1plBdXgbyjv34pHTSb9zoeHMyDy33+DWy5Wt9Wo+TURtOYSQ==",
      "license": "MIT",
      "dependencies": {
        "depd": "2.0.0",
        "inherits": "2.0.4",
        "setprototypeof": "1.2.0",
        "statuses": "2.0.1",
        "toidentifier": "1.0.1"
      },
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/http-errors/node_modules/statuses": {
      "version": "2.0.1",
      "resolved": "https://registry.npmjs.org/statuses/-/statuses-2.0.1.tgz",
      "integrity": "sha512-RwNA9Z/7PrK06rYLIzFMlaF+l73iwpzsqRIFgbMLbTcLD6cOao82TaWefPXQvB2fOC4AjuYSEndS7N/mTCbkdQ==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/iconv-lite": {
      "version": "0.6.3",
      "resolved": "https://registry.npmjs.org/iconv-lite/-/iconv-lite-0.6.3.tgz",
      "integrity": "sha512-4fCk79wshMdzMp2rH06qWrJE4iolqLhCUH+OiuIgU++RB0+94NlDL81atO7GX55uUKueo0txHNtvEyI6D7WdMw==",
      "license": "MIT",
      "dependencies": {
        "safer-buffer": ">= 2.1.2 < 3.0.0"
      },
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/inherits": {
      "version": "2.0.4",
      "resolved": "https://registry.npmjs.org/inherits/-/inherits-2.0.4.tgz",
      "integrity": "sha512-k/vGaX4/Yla3WzyMCvTQOXYeIHvqOKtnqBduzTHpzpQZzAskKMhZ2K+EnBiSM9zGSoIFeMpXKxa4dYeZIQqewQ==",
      "license": "ISC"
    },
    "node_modules/ipaddr.js": {
      "version": "1.9.1",
      "resolved": "https://registry.npmjs.org/ipaddr.js/-/ipaddr.js-1.9.1.tgz",
      "integrity": "sha512-0KI/607xoxSToH7GjN1FfSbLoU0+btTicjsQSWQlh/hZykN8KpmMf7uYwPW3R+akZ6R/w18ZlXSHBYXiYUPO3g==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.10"
      }
    },
    "node_modules/is-promise": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/is-promise/-/is-promise-4.0.0.tgz",
      "integrity": "sha512-hvpoI6korhJMnej285dSg6nu1+e6uxs7zG3BYAm5byqDsgJNWwxzM6z6iZiAgQR4TJ30JmBTOwqZUw3WlyH3AQ==",
      "license": "MIT"
    },
    "node_modules/math-intrinsics": {
      "version": "1.1.0",
      "resolved": "https://registry.npmjs.org/math-intrinsics/-/math-intrinsics-1.1.0.tgz",
      "integrity": "sha512-/IXtbwEk5HTPyEwyKX6hGkYXxM9nbj64B+ilVJnC/R6B0pH5G4V3b0pVbL7DBj4tkhBAppbQUlf6F6Xl9LHu1g==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      }
    },
    "node_modules/media-typer": {
      "version": "1.1.0",
      "resolved": "https://registry.npmjs.org/media-typer/-/media-typer-1.1.0.tgz",
      "integrity": "sha512-aisnrDP4GNe06UcKFnV5bfMNPBUw4jsLGaWwWfnH3v02GnBuXX2MCVn5RbrWo0j3pczUilYblq7fQ7Nw2t5XKw==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/merge-descriptors": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/merge-descriptors/-/merge-descriptors-2.0.0.tgz",
      "integrity": "sha512-Snk314V5ayFLhp3fkUREub6WtjBfPdCPY1Ln8/8munuLuiYhsABgBVWsozAG+MWMbVEvcdcpbi9R7ww22l9Q3g==",
      "license": "MIT",
      "engines": {
        "node": ">=18"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/mime-db": {
      "version": "1.54.0",
      "resolved": "https://registry.npmjs.org/mime-db/-/mime-db-1.54.0.tgz",
      "integrity": "sha512-aU5EJuIN2WDemCcAp2vFBfp/m4EAhWJnUNSSw0ixs7/kXbd6Pg64EmwJkNdFhB8aWt1sH2CTXrLxo/iAGV3oPQ==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/mime-types": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/mime-types/-/mime-types-3.0.1.tgz",
      "integrity": "sha512-xRc4oEhT6eaBpU1XF7AjpOFD+xQmXNB5OVKwp4tqCuBpHLS/ZbBDrc07mYTDqVMg6PfxUjjNp85O6Cd2Z/5HWA==",
      "license": "MIT",
      "dependencies": {
        "mime-db": "^1.54.0"
      },
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/ms": {
      "version": "2.1.3",
      "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
      "integrity": "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
      "license": "MIT"
    },
    "node_modules/negotiator": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/negotiator/-/negotiator-1.0.0.tgz",
      "integrity": "sha512-8Ofs/AUQh8MaEcrlq5xOX0CQ9ypTF5dl78mjlMNfOK08fzpgTHQRQPBxcPlEtIw0yRpws+Zo/3r+5WRby7u3Gg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/object-inspect": {
      "version": "1.13.4",
      "resolved": "https://registry.npmjs.org/object-inspect/-/object-inspect-1.13.4.tgz",
      "integrity": "sha512-W67iLl4J2EXEGTbfeHCffrjDfitvLANg0UlX3wFUUSTx92KXRFegMHUVgSqE+wvhAbi4WqjGg9czysTV2Epbew==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/on-finished": {
      "version": "2.4.1",
      "resolved": "https://registry.npmjs.org/on-finished/-/on-finished-2.4.1.tgz",
      "integrity": "sha512-oVlzkg3ENAhCk2zdv7IJwd/QUD4z2RxRwpkcGY8psCVcCYZNq4wYnVWALHM+brtuJjePWiYF/ClmuDr8Ch5+kg==",
      "license": "MIT",
      "dependencies": {
        "ee-first": "1.1.1"
      },
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/once": {
      "version": "1.4.0",
      "resolved": "https://registry.npmjs.org/once/-/once-1.4.0.tgz",
      "integrity": "sha512-lNaJgI+2Q5URQBkccEKHTQOPaXdUxnZZElQTZY0MFUAuaEqe1E+Nyvgdz/aIyNi6Z9MzO5dv1H8n58/GELp3+w==",
      "license": "ISC",
      "dependencies": {
        "wrappy": "1"
      }
    },
    "node_modules/parseurl": {
      "version": "1.3.3",
      "resolved": "https://registry.npmjs.org/parseurl/-/parseurl-1.3.3.tgz",
      "integrity": "sha512-CiyeOxFT/JZyN5m0z9PfXw4SCBJ6Sygz1Dpl0wqjlhDEGGBP1GnsUVEL0p63hoG1fcj3fHynXi9NYO4nWOL+qQ==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/path-to-regexp": {
      "version": "8.3.0",
      "resolved": "https://registry.npmjs.org/path-to-regexp/-/path-to-regexp-8.3.0.tgz",
      "integrity": "sha512-7jdwVIRtsP8MYpdXSwOS0YdD0Du+qOoF/AEPIt88PcCFrZCzx41oxku1jD88hZBwbNUIEfpqvuhjFaMAqMTWnA==",
      "license": "MIT",
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/proxy-addr": {
      "version": "2.0.7",
      "resolved": "https://registry.npmjs.org/proxy-addr/-/proxy-addr-2.0.7.tgz",
      "integrity": "sha512-llQsMLSUDUPT44jdrU/O37qlnifitDP+ZwrmmZcoSKyLKvtZxpyV0n2/bD/N4tBAAZ/gJEdZU7KMraoK1+XYAg==",
      "license": "MIT",
      "dependencies": {
        "forwarded": "0.2.0",
        "ipaddr.js": "1.9.1"
      },
      "engines": {
        "node": ">= 0.10"
      }
    },
    "node_modules/qs": {
      "version": "6.14.0",
      "resolved": "https://registry.npmjs.org/qs/-/qs-6.14.0.tgz",
      "integrity": "sha512-YWWTjgABSKcvs/nWBi9PycY/JiPJqOD4JA6o9Sej2AtvSGarXxKC3OQSk4pAarbdQlKAh5D4FCQkJNkW+GAn3w==",
      "license": "BSD-3-Clause",
      "dependencies": {
        "side-channel": "^1.1.0"
      },
      "engines": {
        "node": ">=0.6"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/range-parser": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/range-parser/-/range-parser-1.2.1.tgz",
      "integrity": "sha512-Hrgsx+orqoygnmhFbKaHE6c296J+HTAQXoxEF6gNupROmmGJRoyzfG3ccAveqCBrwr/2yxQ5BVd/GTl5agOwSg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/raw-body": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/raw-body/-/raw-body-3.0.1.tgz",
      "integrity": "sha512-9G8cA+tuMS75+6G/TzW8OtLzmBDMo8p1JRxN5AZ+LAp8uxGA8V8GZm4GQ4/N5QNQEnLmg6SS7wyuSmbKepiKqA==",
      "license": "MIT",
      "dependencies": {
        "bytes": "3.1.2",
        "http-errors": "2.0.0",
        "iconv-lite": "0.7.0",
        "unpipe": "1.0.0"
      },
      "engines": {
        "node": ">= 0.10"
      }
    },
    "node_modules/raw-body/node_modules/iconv-lite": {
      "version": "0.7.0",
      "resolved": "https://registry.npmjs.org/iconv-lite/-/iconv-lite-0.7.0.tgz",
      "integrity": "sha512-cf6L2Ds3h57VVmkZe+Pn+5APsT7FpqJtEhhieDCvrE2MK5Qk9MyffgQyuxQTm6BChfeZNtcOLHp9IcWRVcIcBQ==",
      "license": "MIT",
      "dependencies": {
        "safer-buffer": ">= 2.1.2 < 3.0.0"
      },
      "engines": {
        "node": ">=0.10.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/resolve-pkg-maps": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/resolve-pkg-maps/-/resolve-pkg-maps-1.0.0.tgz",
      "integrity": "sha512-seS2Tj26TBVOC2NIc2rOe2y2ZO7efxITtLZcGSOnHHNOQ7CkiUBfw0Iw2ck6xkIhPwLhKNLS8BO+hEpngQlqzw==",
      "dev": true,
      "license": "MIT",
      "funding": {
        "url": "https://github.com/privatenumber/resolve-pkg-maps?sponsor=1"
      }
    },
    "node_modules/router": {
      "version": "2.2.0",
      "resolved": "https://registry.npmjs.org/router/-/router-2.2.0.tgz",
      "integrity": "sha512-nLTrUKm2UyiL7rlhapu/Zl45FwNgkZGaCpZbIHajDYgwlJCOzLSk+cIPAnsEqV955GjILJnKbdQC1nVPz+gAYQ==",
      "license": "MIT",
      "dependencies": {
        "debug": "^4.4.0",
        "depd": "^2.0.0",
        "is-promise": "^4.0.0",
        "parseurl": "^1.3.3",
        "path-to-regexp": "^8.0.0"
      },
      "engines": {
        "node": ">= 18"
      }
    },
    "node_modules/safe-buffer": {
      "version": "5.2.1",
      "resolved": "https://registry.npmjs.org/safe-buffer/-/safe-buffer-5.2.1.tgz",
      "integrity": "sha512-rp3So07KcdmmKbGvgaNxQSJr7bGVSVk5S9Eq1F+ppbRo70+YeaDxkw5Dd8NPN+GD6bjnYm2VuPuCXmpuYvmCXQ==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/feross"
        },
        {
          "type": "patreon",
          "url": "https://www.patreon.com/feross"
        },
        {
          "type": "consulting",
          "url": "https://feross.org/support"
        }
      ],
      "license": "MIT"
    },
    "node_modules/safer-buffer": {
      "version": "2.1.2",
      "resolved": "https://registry.npmjs.org/safer-buffer/-/safer-buffer-2.1.2.tgz",
      "integrity": "sha512-YZo3K82SD7Riyi0E1EQPojLz7kpepnSQI9IyPbHHg1XXXevb5dJI7tpyN2ADxGcQbHG7vcyRHk0cbwqcQriUtg==",
      "license": "MIT"
    },
    "node_modules/send": {
      "version": "1.2.0",
      "resolved": "https://registry.npmjs.org/send/-/send-1.2.0.tgz",
      "integrity": "sha512-uaW0WwXKpL9blXE2o0bRhoL2EGXIrZxQ2ZQ4mgcfoBxdFmQold+qWsD2jLrfZ0trjKL6vOw0j//eAwcALFjKSw==",
      "license": "MIT",
      "dependencies": {
        "debug": "^4.3.5",
        "encodeurl": "^2.0.0",
        "escape-html": "^1.0.3",
        "etag": "^1.8.1",
        "fresh": "^2.0.0",
        "http-errors": "^2.0.0",
        "mime-types": "^3.0.1",
        "ms": "^2.1.3",
        "on-finished": "^2.4.1",
        "range-parser": "^1.2.1",
        "statuses": "^2.0.1"
      },
      "engines": {
        "node": ">= 18"
      }
    },
    "node_modules/serve-static": {
      "version": "2.2.0",
      "resolved": "https://registry.npmjs.org/serve-static/-/serve-static-2.2.0.tgz",
      "integrity": "sha512-61g9pCh0Vnh7IutZjtLGGpTA355+OPn2TyDv/6ivP2h/AdAVX9azsoxmg2/M6nZeQZNYBEwIcsne1mJd9oQItQ==",
      "license": "MIT",
      "dependencies": {
        "encodeurl": "^2.0.0",
        "escape-html": "^1.0.3",
        "parseurl": "^1.3.3",
        "send": "^1.2.0"
      },
      "engines": {
        "node": ">= 18"
      }
    },
    "node_modules/setprototypeof": {
      "version": "1.2.0",
      "resolved": "https://registry.npmjs.org/setprototypeof/-/setprototypeof-1.2.0.tgz",
      "integrity": "sha512-E5LDX7Wrp85Kil5bhZv46j8jOeboKq5JMmYM3gVGdGH8xFpPWXUMsNrlODCrkoxMEeNi/XZIwuRvY4XNwYMJpw==",
      "license": "ISC"
    },
    "node_modules/side-channel": {
      "version": "1.1.0",
      "resolved": "https://registry.npmjs.org/side-channel/-/side-channel-1.1.0.tgz",
      "integrity": "sha512-ZX99e6tRweoUXqR+VBrslhda51Nh5MTQwou5tnUDgbtyM0dBgmhEDtWGP/xbKn6hqfPRHujUNwz5fy/wbbhnpw==",
      "license": "MIT",
      "dependencies": {
        "es-errors": "^1.3.0",
        "object-inspect": "^1.13.3",
        "side-channel-list": "^1.0.0",
        "side-channel-map": "^1.0.1",
        "side-channel-weakmap": "^1.0.2"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/side-channel-list": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/side-channel-list/-/side-channel-list-1.0.0.tgz",
      "integrity": "sha512-FCLHtRD/gnpCiCHEiJLOwdmFP+wzCmDEkc9y7NsYxeF4u7Btsn1ZuwgwJGxImImHicJArLP4R0yX4c2KCrMrTA==",
      "license": "MIT",
      "dependencies": {
        "es-errors": "^1.3.0",
        "object-inspect": "^1.13.3"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/side-channel-map": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/side-channel-map/-/side-channel-map-1.0.1.tgz",
      "integrity": "sha512-VCjCNfgMsby3tTdo02nbjtM/ewra6jPHmpThenkTYh8pG9ucZ/1P8So4u4FGBek/BjpOVsDCMoLA/iuBKIFXRA==",
      "license": "MIT",
      "dependencies": {
        "call-bound": "^1.0.2",
        "es-errors": "^1.3.0",
        "get-intrinsic": "^1.2.5",
        "object-inspect": "^1.13.3"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/side-channel-weakmap": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/side-channel-weakmap/-/side-channel-weakmap-1.0.2.tgz",
      "integrity": "sha512-WPS/HvHQTYnHisLo9McqBHOJk2FkHO/tlpvldyrnem4aeQp4hai3gythswg6p01oSoTl58rcpiFAjF2br2Ak2A==",
      "license": "MIT",
      "dependencies": {
        "call-bound": "^1.0.2",
        "es-errors": "^1.3.0",
        "get-intrinsic": "^1.2.5",
        "object-inspect": "^1.13.3",
        "side-channel-map": "^1.0.1"
      },
      "engines": {
        "node": ">= 0.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/ljharb"
      }
    },
    "node_modules/statuses": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/statuses/-/statuses-2.0.2.tgz",
      "integrity": "sha512-DvEy55V3DB7uknRo+4iOGT5fP1slR8wQohVdknigZPMpMstaKJQWhwiYBACJE3Ul2pTnATihhBYnRhZQHGBiRw==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/toidentifier": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/toidentifier/-/toidentifier-1.0.1.tgz",
      "integrity": "sha512-o5sSPKEkg/DIQNmH43V0/uerLrpzVedkUh8tGNvaeXpfpuwjKenlSox/2O/BTlZUtEe+JG7s5YhEz608PlAHRA==",
      "license": "MIT",
      "engines": {
        "node": ">=0.6"
      }
    },
    "node_modules/tsx": {
      "version": "4.20.5",
      "resolved": "https://registry.npmjs.org/tsx/-/tsx-4.20.5.tgz",
      "integrity": "sha512-+wKjMNU9w/EaQayHXb7WA7ZaHY6hN8WgfvHNQ3t1PnU91/7O8TcTnIhCDYTZwnt8JsO9IBqZ30Ln1r7pPF52Aw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "esbuild": "~0.25.0",
        "get-tsconfig": "^4.7.5"
      },
      "bin": {
        "tsx": "dist/cli.mjs"
      },
      "engines": {
        "node": ">=18.0.0"
      },
      "optionalDependencies": {
        "fsevents": "~2.3.3"
      }
    },
    "node_modules/type-is": {
      "version": "2.0.1",
      "resolved": "https://registry.npmjs.org/type-is/-/type-is-2.0.1.tgz",
      "integrity": "sha512-OZs6gsjF4vMp32qrCbiVSkrFmXtG/AZhY3t0iAMrMBiAZyV9oALtXO8hsrHbMXF9x6L3grlFuwW2oAz7cav+Gw==",
      "license": "MIT",
      "dependencies": {
        "content-type": "^1.0.5",
        "media-typer": "^1.1.0",
        "mime-types": "^3.0.0"
      },
      "engines": {
        "node": ">= 0.6"
      }
    },
    "node_modules/typescript": {
      "version": "5.9.2",
      "resolved": "https://registry.npmjs.org/typescript/-/typescript-5.9.2.tgz",
      "integrity": "sha512-CWBzXQrc/qOkhidw1OzBTQuYRbfyxDXJMVJ1XNwUHGROVmuaeiEm3OslpZ1RV96d7SKKjZKrSJu3+t/xlw3R9A==",
      "dev": true,
      "license": "Apache-2.0",
      "bin": {
        "tsc": "bin/tsc",
        "tsserver": "bin/tsserver"
      },
      "engines": {
        "node": ">=14.17"
      }
    },
    "node_modules/undici-types": {
      "version": "7.10.0",
      "resolved": "https://registry.npmjs.org/undici-types/-/undici-types-7.10.0.tgz",
      "integrity": "sha512-t5Fy/nfn+14LuOc2KNYg75vZqClpAiqscVvMygNnlsHBFpSXdJaYtXMcdNLpl/Qvc3P2cB3s6lOV51nqsFq4ag==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/unpipe": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/unpipe/-/unpipe-1.0.0.tgz",
      "integrity": "sha512-pjy2bYhSsufwWlKwPc+l3cN7+wuJlK6uz0YdJEOlQDbl6jo/YlPi4mb8agUkVC8BF7V8NuzeyPNqRksA3hztKQ==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/vary": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/vary/-/vary-1.1.2.tgz",
      "integrity": "sha512-BNGbWLfd0eUPabhkXUVm0j8uuvREyTh5ovRa/dyow/BqAbZJyC+5fU+IzQOzmAKzYqYRAISoRhdQr3eIZ/PXqg==",
      "license": "MIT",
      "engines": {
        "node": ">= 0.8"
      }
    },
    "node_modules/wrappy": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/wrappy/-/wrappy-1.0.2.tgz",
      "integrity": "sha512-l4Sp/DRseor9wL6EvV2+TuQn63dMkPjZ/sp9XkghTEbV9KlPS1xUsZ3u7/IQO4wxtcFB4bgpQPRcR3QCvezPcQ==",
      "license": "ISC"
    }
  }
}
```

## CyberX-backend/package.json

```json
{
  "name": "cyberx-backend",
  "version": "1.0.0",
  "main": "index.js",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1",
    "dev": "tsx watch index.ts",
    "build": "tsc -p .",
    "start": "tsx index.ts"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "description": "",
  "dependencies": {
    "express": "^5.1.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.3",
    "@types/node": "^24.3.1",
    "tsx": "^4.20.5",
    "typescript": "^5.9.2"
  }
}
```

## CyberX-backend/server.js

```js
// server.js
const express = require('express');
const cors = require('cors');
const app = express();

app.use(express.json()); // parse JSON bodies

// Optional in dev if client is on a different origin:
app.use(cors({ origin: 'http://localhost:5173' })); // adjust to your dev client URL

// Example scan function (replace with your actual scanner)
async function runScan(host, ports) {
  // ... perform scan and return results
  return { host, open: [22, 80], closed: [21, 23] };
}

app.post('/api/scan', async (req, res) => {
  const { host, ports } = req.body;
  // TODO: validate inputs, handle errors
  const result = await runScan(host, ports);
  res.json(result);
});

app.listen(5000, () => console.log('API on :5000'));
```

## CyberX-backend/tsconfig.json

```json
{
  // Visit https://aka.ms/tsconfig to read more about this file
  "compilerOptions": {
    // File Layout
    // "rootDir": "./src",
    // "outDir": "./dist",

    // Environment Settings
    // See also https://aka.ms/tsconfig/module
    "module": "nodenext",
    "target": "ES2022",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "outDir": "dist",
    "types": [],
    // For nodejs:
    // "lib": ["esnext"],
    // "types": ["node"],
    // and npm install -D @types/node

    // Other Outputs
    "sourceMap": true,
    "declaration": true,
    "declarationMap": true,

    // Stricter Typechecking Options
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,

    // Style Options
    // "noImplicitReturns": true,
    // "noImplicitOverride": true,
    // "noUnusedLocals": true,
    // "noUnusedParameters": true,
    // "noFallthroughCasesInSwitch": true,
    // "noPropertyAccessFromIndexSignature": true,

    // Recommended Options
    "strict": true,
    "jsx": "react-jsx",
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noUncheckedSideEffectImports": true,
    "moduleDetection": "force",
    "skipLibCheck": true,
  },
  "include": ["src/**/*"]
}
```

## CyberX-frontend/public/full_logo.jpg

```jpg
���� JFIF  ` `  �� C 


�� C		��  " ��           	
�� �   } !1AQa"q2���#B��R��$3br�	
%&'()*456789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz���������������������������������������������������������������������������        	
�� �  w !1AQaq"2�B����	#3R�br�
$4�%�&'()*56789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz��������������������������������������������������������������������������   ? �ڢ��z<��_o�������z<��F���)�X����j���>�(7��)�X�����QM�ǽX����E7��ycލCQ����G�=骃su���$���z<��OQ�:�o�=��ǽ�����cޏ,{Ѩj��uF�
Ӽ��I^��:�o�=��ǽ=CQ�S|��G�=��5���t�@�`u��ŭ��M�ǽX����E7��ycލCQ���G�=鬀c�'q;ؒ�o�=��ǽ=G��)�X����j����z<��F���)��n�,{�W����cޏ,{��z����z<��F���j��G�=��֖�d�S|��G�=��=GQM�ǽX��P�u!�I�zB�ލCQS�Ӫ4@Gzw�=�+��QM�ǽX���j:�o�=��ǽ��� tү��A�Ҫ
Z�Z�}�,{��zz�Q�S|��G�=��5M~�ycޚ�:�w���IE7��ycޞ��u�,{��z5GQM�ǽX��P�����Te���ycޒ���QM�ǽX����E7��ycލCQ���Ə,{�Bǭ-D�(��cޏ,{��z����z<��F���Cғ������ݧTh����,{�W�+����z<��OP�u�,{��z5A��_�)��)�T�������z<��OQ�:�o�=��ǽ����ڏ,{�Y �ZN���(��cޏ,{��z����z<��F���)�X����j�� X>�ꌠ�>��,{Ѩ��QM�ǽX��Q�:�o�=��ǽ�������,{�U楨�$���z<��OQ�:�o�=��ǽ�����cޏ,{Ѩj��uF�6Ӽ��I^�W��)�X���������cޏ,{Ѩj�M(�)��i�J`u���[����z6zz�����c
(��
(����>���>��QE�QE ���N���jB�:�(�0��( ��(���u6?�N���(��c
(��� tҎ����.��-QLaEPM~��k����ESQE QE ���:�~�RB
(��(���xө���.�c���c
(��
CҖ���O�N��ݧR[	lQE1�Q@�iW�G���~��]E��)�(�� )�ڝM~Ԟ�{��)�(�� (�� i� X>��i� X>��HH(��c
(��
j��N���4�����)�(�� )JZCҀ>�:��v�Il%�QE�QE 5��_�)�U���Qu�(�0��( ��ju5�R{	�:�(�0��( ��(��`�S���`�S�	QLaEPM_���j���]GQE�QE QE 6?�N���iԖ�[QLaEP_�Q�R?�4����]E��)�(�� (�� (�� a� X>��a� X>��BAESQE SW�5:��y���(��(��(���i����:��K`��)�(�� k��J:
G���t����QE1�Q@5�S��ړ�uQLaEPEPO��i�I(��c
(��
j��N���4�����)�(�� )JZCҀ>�:��v�Il%�QE�QE 5��_�)�U���Qu�(�0��( ��ju5�R{	�:�(�0��( ��(��`�S���`�S�! ��)�(�� )���:��x��&:�(�0��( �=)iJ D���j}�u%���ESQE ����~��iW�]E�Z(��(�������I�'��(��(��(�����N�����N�$QE1�Q@5~�S�����QuESQE QE ���:�ݧR[	lQE1�Q@�iGAH� tҎ��Qu�(�0���}E��Qp��)���Q�}E����}E��Qp���`�S�2�x�t�o_QJ�C���_QF���;����}E��Qp��j��z��Ea���!�Sw���z��w�QM޾����(�\u���(޾����ݧS�^����P��E7z��7���q�u���(޾������5�m<�P��J��u���(޾���q�Sw���z��.M~�o_QH�8�bc��_QF���;����}E��Qp��)���Q�}E��L.7iw�����:�n��o_QN��)���Q�}E����4o_QHn<�%����}E��S�WE7z��7����qԇ�&�����pO�N�# �iw���=1�Sw���z��w�QM޾����(�\�U����6�E
��K������}E��S��:�n��o_QE�㩯ڍ��)��4���)���Q�}E;�㨦�_QF��\.:�n��o_QE����:�,7�GJv�����)���Q�}E;�㨦�_QF��\.:��xѽ}E a��H�>�n��o_QN�\u���(޾����R����P\z�W�}�u1c�.��'��E7z��7���q�u���(޾������_�)��i�P�09��=G�M޾����)ܫ����}E��Qp��k��z��Fa�4���)���Q�}E;�㨦�_QF��\.:�n��o_QE����:��o�����R���)���Q�}E;�㨦�_QF��\.:��y�޾��Xnni}���(޾���q�Sw���z��.E7z��7����p��ө��oZ]��)'��E7z��7���q�u���(޾������5�m<�P��J�������}E��S��.���R�@	��(���P`z
0=- ��8�N�����})���`z
Z)�LAF�����ST��>��y�\AF�������`z
Z(0=��� b��;�RG�iԖ�[	��(���S���AKE 5��x����M(�)uP��`z
Z)�LAF�����S\8��_�&&.���R�Lb`z
0=- ���AKE 4��8�����
u$!0=���c�Q��)h����q�M_�iu%���(���S(LAF�����P@�JZCҀ�c�;�R'ݧR[	l&���R�Lb`z
0=- �i�h����~��]C�Q��)h�10=��� LAMp8�S�ړ�L\AF�������`z
Z(0=��� ax�;�R���N�����`z
Z)�LAF�����STǊ}5~�K�Q��)h�P���AKE &�������� 5 �ҝ��)�ө-���Q��)h�10=��� c���J�mP� pү����0=���e	��(���P`z
k���k����Q��)h�10=��� LAF����@�8�N����`�S�		��(���S���AKE &�����}5~�R�!p=���c�Q��)h���`z
Z(����;�RG�iԖ�[	��(���S���AKE 5��x����M(�)uP��`z
Z)�(�� (�� (�� a� X>��a� X>��BAESQE SW�5:��y���(��(��(���i����:��K`��)�(�� k��J:
G���t����QE1�Q@5�S��ړ�uQLaEPEPO��i�I(��c
(��
j��N���4�����)�(�� )JZCҀ>�:��v�Il%�QE�QE 5��_�)�U���Qu�(�0��( ��ju5�R{	�:�(�0��( ��(��`�S���`�S�! ��)�(�� )���:��x��&:�(�0��( �=)iJ D���j}�u%���ESQE ����~��iW�]E�Z(��(�������I�'��(��(��(�����N�����N�$QE1�Q@5~�S�����QuESQE QE ���:�ݧR[	lQE1�Q@�iGAH� tҎ��Qu�(�0��( ��( ��(��`�S��`�S�	QLaEPM_���j��.����c
(��
(��ݧSc���Ka-��(�0��(��M(�)�Q�R�.��E�QE ��N��jLOa�QE1�Q@Q@?xS���
u$ ��)�(�� )���:��x��&:�(�0��( �=)iJ D���j}�u%���ESQE ����~��iW�]E�Z(��(�������I�'��(��(��(�����N�����N����(�0��( ���4�j��K���(��(�����=(�ө��iԖ�[QLaEP_�U�����_�)uQh��c
(��
k��S_�'��è��c
(��
(����:���:��QE�QE ���N���j]E�uQLaEPEPc���lv�Il%�QE�QE 5��#��J:
]E�Z(�����4o�4�)j-F��4o�4�(�5��ѿ�Ө�PԌ��8=)���!� X>��Z�\n� cF� cN����n� cF� cN��CQ���5[�nIM_��j-C����QF��n� cF� cN��CQ�����:�5H��^�����ݧRW�����4o�4�)�=F��4o�4�(�5���W���t�������QOQ�7����QF����ƚ�Ӄ֤��jN�a��ѿ�Ө�����ѿ�Ө�P�n� cF� cN��CR2� 0�ӷ���HZ���h��i�S�z���h��i�Q�j7���������4������QOQ�7����QF����Ɠ����j�G�zv� cB}�u
�W��ѿ�Ө�Q�7����QF��?�x4�����_�)u�����QOQ�7����QF����ƚ�ӃRS_�'��o�4o�4�)�=F��4o�4�(�5��ѿ�Ө�PԌ��8=)����`�S�!+���h��i�S�z���h��i�Q�j7���������4������QOQ�7����QF����Ɠ����j�G�zv� cB}�u%{	\n� cF� cN����n� cF� cN��CR7l��҆�W���~襭��M�ƍ�ƝE=G���ƍ�ƝE��w�k?NZ����;�L7�7�u��w�7�uj���h��i�Q�jF_����ƃ��})ԕĮ7����QOQ�7����QF����ƚ��7����jB�ƍ�ƝE=G���ƍ�ƝE��w�7�uj��|�;��?�N�����ƍ�ƝE=G���ƍ�ƝE��l� )�҇�pi_�Q�R�-D��h��i�S�z�QLaEPEP����������
(��(���y�����H]GQE�QE QE 6?�N���iԖ�[QLaEP_�Q�R?�4����]E��)�(�� )�ڝM~Ԙ�è��c
(��
(��~�SO��HAESQE SW�u5~��LuQLaEPHzR�� ��i�����Ka-��(�0��(��M*��H� tү�����QE1�Q@5�S��ړ�Oa�QE1�Q@Q@?�ҝM?�ҝI	QLaEPM_�i���ƗQ1�QE1�Q@!�KHzP'ݧSS�ө-��
(��(���4��E#��J�tR�.��E�QE ��N��jOa=�QE�QE QE 4� �Ju4� �Ju! ��)�(�� )����M_�Ժ���(��(��(���i����:��K`��)�(�� k��J:
G���t����QE1�Q@Q@Q@?�ҟL?�ҟHH(��c
(��
j��SW�5!uESQE QE ���:�ݧR[	lQE1�Q@�iGAH� tҎ��Qu�(�0��( ��ju5�Rb{��)�(�� (�� i�M?xS�!QLaEPM_�i���ƗQ1�QE1�Q@!�KHzP'ݧSS�ө-��
(�-����b�'�F8�I?����GE{O���+Ǟ;�-��,Ͽ�=��}+�O؃��T�]�]�|�������γ�?�2f�R����0��߲������^���w����-.�U�Cgk5ԭ�HP�?�zO�� fO��)Tk\[D��!���k�þ�<'n!�4{== ��!U'�{��J�1�6�_�Q]��r��Ϩ�´ֵ�7��|1���ė�[W�,��?���?��k��?`
}�ė�>�L+�&�����Ob[kȻF1_���S�2�b���;���_m0e�T�=����EkE��3���q'��^�Ң}�U����ۯY�W�ϋ�������I���Y^;R��x�߱��I~�q���k>�� �u8!F��\?1^�/mۤ����eG����4���COlmO�	�������~��[���������hǡ�V@?,W��� �?��76��X�(賫D���־袽�'�M��<봢��k�'%L�/�� .�������{�?�U�Mw� ��DMǮ��;�*�J������U8)4eH����ck�мO	�U�,�#�l~b�� .�G0��K�������SzШ׮��~E�_�:��<�a$�O��]7#�m�g�O�"�'����T�O�ۍT�>x�A�ʇ�
���x�)�i:XI8�J�2Vv��?�>K��r��U^=�Ɵ���N�����N��G���(�0��( ���4�j��K���(��(�����=(�ө��iԖ�[QLaEP_�U�����_�)uQh��c
(��
k��S_�'��è��c
(��
(����:���:��QE�QE ���N���j]E�uQLaEPEPc���lv�Il%�QE�QE 5��#��J:
]E�Z(��n[�~te��J��)�oA�і��������oA��p���`�S�2[x�;-�?:Wc����F[�~t�;������oA��p��j��-�?:j���
W%ܷ����zΝ�q�Srރ�-�?:.E7-�?:2ރ��p��Ӫ4-���e��I0Luܷ����zΝ�㨦��F[�~t\.�M(�)�[i�P`p)_P�����F[�~t�E7-�?:2ރ��q���F[�~t�-��boBJ)�oA�і��;�㨦��F[�~t\.:�n[�~te��E��~�Td���;-�?:I��QM�zΌ�����.:�n[�~te��E�㩫��oA��AmǁJ�d�Srރ�-�?:w�QM�zΌ����\u!�I����:΋��>�K\ʱEK#* �'�]�¿�>'������d~��oeE�=ϰ�����~�QoԐ���c/{p��>�;}z��<M�9gAӛ���Ao� o?����r��ZQ\��� N���� co��a���xJl0Y3�=���_a|8���6�4�*9/ ��n@yX����+�����U]OU�Ѭ亿����1��g
�}M*g�k�q$�:�i�����/��~���p��ywօ� 
F`��@�5�_Ŀ�w�>y�<9n� �\�8���
�s�� ���~�$����O��[�.=	�ν|��\�6J�h{o���G��&/�0xov/��m���0������ k���S���'��5�'��</a�4]"�Sq��"$?�����K1g����6I��l�_��d�T�2r�/^U�-��6.��$����� ��ψn��;�L��4��BT���$Ҽ�[��>$�ۄ�'��O�����k˲ރ�P�p���+�L'
d8��
�\S{�<J��2��U�������W�/3���T�?߻s�j��+֦����� �;�T��5����6?Ҵ#�G�����} o�k�CNXG���Z}��G�5�?��ש���?�]��W�,�Zj�0�R������#�p��/���g�hڕ�b[����L?�'u�%�LNU�կ��=�������]��Ĺ� ���C�����0��6��c�h�nq�W��Fp�T�7ܷ������E�_���ߪ�O�Vg],�G�/��Ϻ�+�z�oP)��]�x2@�T^���l����� �<Ai4��	˓��l���zΝ���b�:l��2�$�',�F^���z�'���l]=*�%�?���ذ�ɸ0+�p<W�_��4�|J����I�L��g�3���q�j�,x�?�1��SK\c�o�zu�\��K<�$�]�噎I5<���o2���WSqME$��]�ˠ�L�c�{B���O����Td����N�zοpL���QM�zΌ�����wE7-�?:2ރ��q���ƌ���頶���q2J)�oA�і��;�㨦��F[�~t\.:����z΂[�~t\.	�i��AN�zΒ`��)�oA�і��;��QM�zΌ����\�U���嶞
[h�R��������oA�Ӹ�:�n[�~te��E�㩯ڌ����[�&�ބ�Srރ�-�?:w�QM�zΌ����\uܷ����z΋��� �JuFKo�췠��&$�QM�zΌ�����wE7-�?:2ރ��q����F[�~t�-���"J)�oA�і��;�㨦��F[�~t\.:�n[�~te��E��ݧTh[oAN�zΒzz�����oA�Ӹ\uܷ����z΋����5�m<
l�J���E7-�?:2ރ�p��(��(��(����O����O�$QE1�Q@5~�S���������)�(�� (�� lv�M��ө-��
(��(���4����iGAK���ESQE S_�:���1=�QE�QE QE 4��N���)Ԑ��(�0��( ���4�j��K���(��)���H��]��*��h����ɯ�g��:��o���Ё��d�� ����m��%��G�m�9Ė�l���8����e!EDP��T`_�k���d����E��>~}:w>� '��Q,F1i�?��D����M.;I����!�� ��I�Xг0U$��+��4�h����vv��,} �kᏎ����I�����,�!�?�#������e�5�����%{y���}�>�0�p�\��"���W�_�����v�]�W*|���G���}�|]��/��(^��ާ,��)i+
}Z�	,I$�z�J�Y�PI= ���ଧ� �B�z�Z��H�O�g�����v��{-���GZ��� ���>$�>���^���+���?d��"����wQ\=���?<����#t���E�a���_���"�cm%X����w��<_����wWQ��8���Տ�^��u���_kpi��`�_5���?�}�k0�6��J0�� }M��ᙯ�9�-��c1�������p���������g��k�-�y����.��;��b>�q^����7��/i�GFx�~'&��.��#�/�
�uϊ���o�����U�]ߖk��٦}�O�u�To�r��������+�F?w�Ξ�J��m����aj�H�H��Exޡ�Y|5�����;C�+_�G��v��O��R�
g��儨�c/ԇ��CGV?z=�G�h�"�����v�m���xD?��é1���/���� *ر���_2���S������y�e������ Y�z*����k_	<�a}�6b�\[���9�5��c��[ֶ�ZL��mf$�lס��|��$Ӯ�"�.��5��{��T�}Q��G1ϲyZ���nI}�B��b��#/���ş�N�l�I�� Cw�V���Fk�|k�3��.ڶ�p��� /�2?��k�ͦJ#�2�"Ȍ0U�A��2�3�Q�(֏��޴��<LOa*��n�_����D$�;+��/����	$�`F�܋��u�k���w�>	n�S�{J\�:�x���� 
��#���:j������������>/�c0i�����sÏ����Q$m�J:�U���IZ�4�?x~��^!��A��ٖ�$��:����d�����u��Kq<�2�� �_x���h�⧘lnR��u�5�}�/��7�mWF�K�]F�捻�ƿ�O����S�(��8����^[w�����+���9�O������$��'��<&�_h�--�ޖ�{z�|�ARA#�5���)V��z�G����#Յω�n�]�d��cz��ڸ�/�ITq˳�k�j>�R� ��������:��������xԳ�%����ʄ�#GcQ/�5�t�����uQT0��( �=)iJ D���j}�u%���ESQE ����~��iW�]E�Z(��(�������I�'��(��(��(�����N�����N�$QE1�Q@5~�S�����QuESQE QE ���:�ݧR[	lQE1�Q@�iGAH� tҎ��Qu�(�0��( ��( ��(��`�S��`�S�	QLaEPM_���j��.����c
(��
(��ݧSc���Ka-��(�0��(��M(�)�Q�R�.��E�QE ��N��jLOa�QE1�Q@Q@?xS���
u$ ��)�(�� )���:��x��&:�(�1UK�U�8 w���e�ٶ-2��Ş(�x�=�����ga��^K�#xO��y'ԣY�� �J��!�p#ۭ}��@ p ��<C�z�v�|qm'9u��+׫����M
��Օ�~���� B�p���4O���js�`~�h��������� �?����{�_J
���H޿A�_�^=������r�O!;S?,k�Tv��pEL����:9>�˻��<Ρ����֣�<��O�_��:��j����ȳC������q4��������h`�����"������Yכ�Q�O�W�� �G��i�|I�٦��]��18ܐ���>���}��:����|a�k:�:f���!?hm�*���ڿ8�fo+�����������������¼[�ͯov�_��G!X�*��8 I-�pF�H�(�f8�;�?�]�[�z}��ځ,V�����_$|I���_�&Y���t�?-��(��'��k���3L᪕#�����-��ϻ�3�݋�e��������7��?�oS#��#>��
��ƿ����2-��G��%�K���|�!$1'&����r��<���J�=���o�i�����x�K�%ȼ��s�������~ ��V��U?��r�+�r��}X�kg=�;xd�C�XԱ�+�оx��(�i�˱ty���5�r�+���(���C18�{�S6p4W�韱�������>�ͻ� A�m��x�� ��:Zb�� �5�T�̎���q�;�W=䙔��	~_��}5�W�|S���Q��_�o���k�RHC�p<���^���h��J�q}Q��pհ��u��.�z�!ʱS�q]'��$����Z���ވ����+���+P���%h).�'��¤�h6���W�m��"֭���W#˗�~��G��ڻ�>8�������^��O�t��� �pk����2NT��)���� ��>�	�X�+JR�]���~�Cw�K$R,���d �O.pA�k�7��ǿ�5�1a��͊�l��x����+�� ���/�>"���t]`��L�$������^{��L�Zk��]c��[����]�L{P��g�2���ُ�� [�xWGֈ$][�
�������~%�$���U�u�F�|���b�z��+��LA�Ee���z_�4���^�+�IW���z��5�27�����_����Y�P�'R��S�G�S���u߅��z��t�2<�v9�U�a�k�~=~��� $�V�D����'2[�7�����.//�=;T�5f���F~Q^�',�r�8�m�i���~6h�t5���`�c \�9����Q�^��W��<a�x]�մ������
�wR;�_�� �8�4%te�� P.����/�5���<�o�NT�'������y�*����>G����l~$���^�X�8Խݤcp:���u�CF�L��Q�� ��i�#�_����ٵǌ�;o�X�xS� = �����>.�2��Zm	?�%�����!�x�2� �W���)QE�
~fQE ��-!�@�v�MO�N���(��c
(��� pү���*��K���ESQE S_�:���=��ESQE QE ���})����})Ԅ��(�0��( ���ju5~�R�.����c
(��
(��ݧSc���Ka-��(�0��(��M(�)�Q�R�.��E�QE QE QE 0� �J}0� �J}! ��)�(�� )����M_�ԅ�uQLaEPEPc���lv�Il%�QE�QE 5��#��J:
]E�Z(��(�������I��:�(�0��( ��(��
u4��N��QE1�Q@5~�SW�]D�QE�v�	�'��(�dZŒ	�+��	�Z��_�c£Gi����ߖٔcw���_�_#�p�W�V�#δ�v��� ���;�e��*�_u{zOď�����ϫ꒒X�(�"N�+�=)k��~����-BgӴT;VE_�c�/��z��F#��T�)AY%�$�*19�#��r��� ��O�N���"~����������]��a.H�_)IE##����Pk,�9��4�L$�ˣMY�L�+�esP���۪bP(����
+{���|y�&��Y���~bʃՏj���O읢�XC�2�Ƥ0�?s��_1��$���y��� ��g��d���_����Oo�?#�_�� <W�"U����+2pחd`}{����?b� i+�!��V�`�b��_OS�W�v��eCoC*F0 �
���~�q�k�7;�P��r�����0XD�Y{Iy����O|?�ׄ"T�4kK<q�#� ��tb@ڹ/|L�׃!/��֤s���G5��"��</�3ǥ���n:9ZϟҾZ�I�f����J����o��b�;/˗%I�6��F��y���n�s��kl;y�� 
�g���w,��t���V�5�T�=�j+�1����sşepvRo����~6��[�,��J}��Yp����5���Gֻ��|S�)-gP/j�r�D6ǟ\w�k�~��7	p�^�Εy�)��l�ß��kO5�э�mwc�K{y.�P�,�FI'����K�Y�� |;y�m�Whd-���ȯ��T�3�wݻ�m�>~�J����i_��^���_�_CK��N�M��w%�)b���j�?��oé\�s�fv�|d}GOƿF!�I�I#p�YNA���-Ȳ���2�W����j5��
3��oF�[��W��JJ4[���U�V?*zR��lX��A����o�GB�j����>�r�Z���~��
��>�|	��a��Ik2����\z��+�|���9�?q+O�^� �W���g���~�7�I-����c���<qo�x�G�t^�c��������<S���I�RҮ㻴�r�g�>��+�����A�K�Z�Q���r��t�>�d��q�=�|p>2R�`�^�e/�~}z�=���j`ڡ�|���_����⼂H'�e�E*��!��E|g�G~ͭ�'�'�`i4�%�-d�}G�?ʾ���-'�.���\	#q��O�wR+��c���VH�da�A�k�̣1�p�5�	�;J/���f~���p��&�}c%��t~Tt��x�S���u�*c����׺�c^��J|>���Z%�i�3@�?gc� ������p8�&{�����MY�����qxLFU��u4�uO�h�1�W�CN���h5[.�[��D�����8�-�tYa�J:0�`z�_�~+�|*�\7�3>�1	wo�=~��CtMv��:M��c2�ks�7S�A���)�dX�j?�}�����~ɐ��ͨr����w���~�ᗉ��lt+�/�M�����o�^����[��I��r��f����^x7�W�=��������}k�~��m���!���� �]�G� ��r���ڒ��� ���z(��F>0)JZCҀ>�:��v�Il%�QE�QE 5��_�)�U���Qu�(�0��( ��ju5�R{	�:�(�0��( ��(��`�S���`�S�	QLaEPM_���j���]GQE�QE QE 6?�N���iԖ�[QLaEP_�Q�R?�4����]E��)�n���kzӨ�aXn���kzӨ��a�[֍��N����;�=��[֐� �J}+	!�[֍��N���a�[֍��N����oZj����)�����`�޴moZu�;�޴moZuX,7kzѵ�i�Q`���;kz�ݧRKA$7kzѵ�i�S��7kzѵ�i�Q`���J����+j+j&���kzӨ�a�n���kzӨ��a�[֚���z����4&�kzѵ�i�S��7kzѵ�i�Q`�ݭ�F���QE��d6��;kz�~�RHV��h�޴�)�v��h�޴�(�Xn����wjJ��G��o�-�~��@��¯v?AYU�)Aԛ�Z��ӕYƜ�vF���kz�ܺ_��k=!mnl廹ۆ�y|� |����I�Uⅵ�V�N�S-����*}�|�[Ęһ�Ѻ�K�^ݵ>�1�vWAb+Yǭ�ާ��oZ6��:��zmƱ���Z�e���h�9$����Sod|���Inv�~�|Q�l6�2i�%��p��=�~�h�]����m>����@�ƃ \O��V��!m�F�ג%��r���]��q�B���8�K31� u5���ٴ�W-?�CH��>�G�d�ʰ���%����_�O�>)��/�=Be������p�5����� ijחj6,�<�}2I��^��B�h��6��}��t+7+���:�������dR�pҭ[�m;%���~e�9�3,B�G�}{��Ӱݭ�^��w����SRV��x��׌��W�Տ���(�i�[��<���� �_z��A�l|5�[��u�[Z@�R4�k>%�U�'��;�{��� �t���1k�V��7���<��;����{U�@��#/!�c]/��Y�����i-���oo�y$8 W�?j���G�\�+&�~�� ��=���O�ϱ��o��z���O��dt��]"�~��=��_Ǐ|4����^j�l��_���k��Ԟ/�I���%�p#�?9��� ����i'����ZI$�sQ/��VS�vZ��G�O����O�3>'�������o�d�w�7��7\J�,�1bO��;[ֶ4	�)�iZu�쇴HHS^��o�������վ��;���������b*(�u������񹃾���O��x.���kz���7�w�U_�F���]�F��t6� �׀����� ~c_/S�2�;G�^���>���W�,}_�\�_kz�\9��ne�\gm��� �9���sU��<1rص;�F����QO���.h���lUx/4��ye�� ���{[֌7�}�_���Zr��M�����6�۟��׎x��:�n:��qd��t�v���_O��p8� �z�O������b�n�Ⓤ���Z�Ï�Kş�+V�j�bp-�NJ�En����g�C�g�*G�7T#��I� d����|3Io*��r)ʲ�k�͸K.���%G������I�˚�|��� G�����7=��to�:<�~�h����<g�Oj�{���Kw�I���Ǆ����������4�Z�W����t���w$��A��?%��8��t��%��}���2���P|����z���?�7��[�f�fM׺,��Wj�w���5�;[ֿN��.�^ӧ���.mfR�� ��s��;��Z�]Z+O�\10ˌ�g��_�p�� h%��;U�� ���~a�|2��Ⱚ����� �����z����}i#If�-ͩ?,��5���i�8�-u}2a-�˜g�=��_�U�_�4_|(՛*�zD�����?�_zӊxf�?��իG� &]�{?���y��j}_� t� �W�ӿ�}����j�3��ĳ�L�$��C_�_�/�� �zM�����?e�}C�~��Eyt�.�5B#��hV���}+�=[��&�y�޿�uu!�F�5��VS���U�".j�}_{yw=^/�0�t����ӽ�E��v����do���߿��;��LK�3������_4T�u��^�ݴ�+�I��r+��|��m���]�gџ�c�e��b)��w]Q����͟�����x��/��@#�
9h�1�t�S�C���	��Շڂ��PVA���S��W��l��Koq�D=�5�遝|�1U-iA�K���^�w��E�3WO������F���������u-"@|��-���V���Ն"�j�w�����q�Ft*J�EiE����oZLZ}!�[X��N޴���B}�u$�Cv��[֝E;�v��[֝E�;O4�i_�U�����kzѵ�i�S��7kzѵ�i�Q`�ݭ�Mpx�IM~Ԛ�M���kzӨ�a�n���kzӨ��a�[֍��N����;�=��[փ��})�XI�޴moZuXv��h�޴�(�Xn����;�����y�XV��F���QNðݭ�F���QE��v��[֝E�;zӶ����u$�Cv��[֝E;�v��[֝E�;O4�i_�Q�R����moZ6��:�v��(�0��( ��(��`�S��`�S�	QLaEPM_���j��.����c
(��
(��ݧSc���Ka-��(�0��(��M(�)�Q�R�.��E�QE ��N��jLOa�QE1�Q@Q@?xS���
u$ ��)�(�� +�� ����P�M�c,~�lH���?A_2��=��PF7I+�P=I�~�|;��~�f������ w<��kḷ���Z��[���|�}o�3^�5���g[�{��_�ǋa��mg���ƛ	Y}�q�b���g���5Rv�-'ԁ�����\��׵{�F��s+J���_/��o6&X�- ��_����9�*h`���ߢ� 7�����/���ԧ�U�Y���V�����^�i3뺵��l�繕c@=I�П�r�����e-�
�w?�}O��	�joީ�u���ϔ�̫�ǉ�����}���M�{�Ͽ�GŃ����tؽ�\ܲ�R?Oƽ��~&�𧇯�[��E��{ο><W�;�k�ڭ㗞�B�'����|+�G���U���_O���n1;��XJOߩ�G�߷�d'J�~|:����4�pR�~{���i��N��[�ⷅ�J��'�}��K�?�'N�u;�$���{/�W���k����?�-#�#�>�e�b����u�����[Ö�-��6��
 ��O��z��k�XO{y:�m
�y� )u�K3U$���<��>4K�ZMK���j�]�� �q��~=�e��W+zo)]Y�fq�a����1�� u3~7�u����Icc#��0�	83���^GEu?>��İ��"0s5��%�5��
\��F_�~g��jؼ��+Τދ�^F&��j%���M����S��1�ξ��c�'�YE���T�,�8E�c޽K���ᮘ���$�a��;��=���k�㉱��`�$;�����d�C
�lz�o����:6���z�m��(l�Q���Z��=���ş|?�/�ޯ����#�F�;W��0���{�x��!�&��r>�|�!��o�B:?��� �}?;�2���M]}��������d���ϫ��p�p!�iZ���~+��^��޻x���(?!���5+���5�ҷ��&���M���K�_�G����)����v��?J�W�s����I�j��d0#�W�dZ���B:r+�Ѿ+����+�k����y��sE^�W�Y7����Ǵ[�������~�y��KV�l5�G��-b��q�IP0��|!�\�6�k�Q��2��8N����?��x�%�;Qs����l���_+��1�k�4_ij��i��2���t���̴���y_Ŀ�>��e���~X�Jr�짵|��j^Ԥ��-$����1�p{���k�����E���=����*�F3��}&Q���+T���;�_���=�peT]l�>�e� ��~}W�����4�#��w�Хo�@NL�/�W3�#ឫ��YkK��۱&�$��>��W�ias\7,�8K����i��������'����,�G���}��ZΡ����&�c��L�aY�gR��:{�q_��� f���U���K� �� �s�C�־ъ�'�$����U����34�����E�_���Y.iC>�94�����џ|Y�mw���3i��KG������+����4�9��G�g�T�V��k'}��~�������[y��4LQч ����A�ia���$t~~?��c�rW�������.���QE���5~�SW�]D�n��~ �������	�e�Ҿ��=��&��]>���и�v �W�Oÿ��/�z�l	��g�����>1��lţ�[}��?j�l��Q�oXj�� s��#��<���e�[x� h�D��z�5�e~�x�C��~Դ��d���g�c���;�K	4�F��PVH$h��W�p�-���,ްzz?�7>{���c#��Ң����Z����=+�O��O�N��ݧR[	lQE1�Q@�iW�G���~��]E��)�(�� )�ڝM~Ԟ�{��)�(�� (�� i� X>��i� X>��BAESQE SW�5:��y�uQ�QE1�Q@Q@��ө���u%���ESQE ����t��M(�)uQh��c
(��
(��
(����>���>��QE�QE ���N���jB�:�(�0��( ��(���u6?�N���(��c
(��� tҎ����.��-QLaEPM~��k����ESQE QE ���:�~�RB
(��(�G���1� 	7Ľ4:&�L��z���^e|��$�^U�����#-�m�9o�_Dy��/��q�= ��Y��8��Q�ֵ-����%�X������b�l��o��� ��|�^��G���n�W��,
L�?���-����	��z�_���� �~��U�zE�����+x@j�/��fM�i��dq�7O�f���+�?gO����J˶{�7O\t��k�f�[xd���@+���c�.�E�� �~���z�eT�Vr\��� ������R���`7�E�o�����t��J�.񮫩;nY&+�s�B��H7;��rk��������~���g�ծ�W�}���n����w�2k�qn���"8iO¾��+��W�H��}7NU7�$������Uՠ��ۛۇ	�fGc�~[�V�c��֩h�?���\=��(�a	�&�����-'��>*7��1�i���o�������������Mo���s���W���O�!ا�Pt�`W��N_����=_���. ͥ��Z���+����<!}�[iV��V��"�c_s|>�&���@�N��n�3LG�#w&���^�Ş������^H��wU��� �8��A�������{��?_�솞	uEz�ג{%�Գ%�C<�d� +�_�_���m#²�ee����k����%���sC���d���g���_>���]�/B��W��� ��QŲ��˥ki)/���Y��.uK�.n��w9i$bI5^���m֭y��sq!���5�~��廊+�ܵ�<���~-ھ����az��e��?8˲�vqQ�.��_�ϟ�*���5�m�V�f:�Q�7�W�^�a�oĩe��_�i"c�]<qC�H�Tt@�����;R�V~����W�b}�������{���c3�QV��³&F����aن~�:E"�hՁ�TW7��6�ǉbd��휷�o�T��tݪҷ�G�uo��&�տ��|SY_\i�)qk3�·+$m�־������-׆n����w��j��V�/4;�,��䵹�ᣑpk���>:?�����q��e�c�y���]���?�C�"���A�����!#�;�M� �_I�w�),N�F�r���+�j�����&�s�u�����m�s�����_�p�6�'	>��_�~���Y>x�]=#'��� ��}�i�>�'�5�+�&>h۱�ǎ�}�/��W�s�rc��
��LA�Ey��o������Oo:���!`9q�k��s	`*���r��>��8z9��h/���K��}����}+�Oٓ�k�KxsP�����s����Wɲ���Qԫ�AS���o��<�[Zو{y0Ľ��_�`!��I��� �~-�f���ѭ�^�^_�7?C���3���|4]~/�Ŷ���(�e� �kC��״�MBك�qȤ{�����t�u-5�4��������2��˱���l�?��9�Y�-�!��4_�O�c�����W�4�&#�������̞��H�]�؊��~���F��!���\�3��M~�W������޽�\:���|7W����~�?�=H��t{k�(,�w8����?�G�[O�v����L�%L]DN;c_Y�j�P\�wG2R=�p� <:<O��T�&����q�W����+��0��ʬ�Rvw}� ���ϲ,&++�hSJPW�K�����
�{�F�g�����,.!� 	���|�ҽ�?�O�~&ir3���w�0���D�0���O�W^�S��}G5�S�|��Z�>��+��O��� n��v��(�^;�����>mx'�g����z�/�m)�����~���;7��Et���~'�|g���S9��6��?��.R����~�7�v�MO�N���(��c
(��� pү���*��K���ESQE S_�:���=��ESQE QE ���})����})Ԅ��(�0��( ���ju5~�R�.����c
(��
(��ݧSc���Ka-��(�0��(��M(�)�Q�R�.��E�Sv
6
B�u݂����u݂����C��})�Q�})�
�WE7`�`�z����Q�P����j6
j���j-I(��lQ�Sv
6
Q�Sv
6
5B?�N��Zv�B��\u݂����u݂�����Q�SY�B����5��)�0�u݂����u5�Q�S];��ĔSv
6
��)���)���)�A�S�
HZ����Q�S�������$TX�@�g� 4���:fF׸-;������ZZO98�?>�5���a�xWI�]�jG�њ�����/��¶�����_�U��8�� �_�?�p��[�C�8~Q>,���ƽ�_37��>��TZM�jz����Ҭx���T]��m j��X��#��#�Fk���4[]�)a)O��I�9%���M�4�&��>�1�a��2x��χz��m���� i���̯����/��V�i��=@�_�`���.���I�����+Ն����E��3��]��� |E�b�wAn�h���?:�6
��R�B6����	��~��Ut�������?��g���P�%���#��}"�c���{i>�I��ͨ?σϖ:�u��e|��Fk�Z��5�l�c��S�+�����kH��G��i�x�j.ҩh��� �g��M�(�+����S��|o�pɦ���Z\��v�6=q�]�?�rGG������,�Q�f�`?����F�^ML�V���5�������u-Yi�]�+����f<�z�W�=����T�Ӭ!3\��U�ϵf������>��u�ȿ�cz�MØ��?����';k�ˇ�Z��9PZEk'���_¿��wý5��j��r�$E��eV�+Ⱦ.�u����� �ΪF��?�k󵇯�V��g��i��9�NV�8캷��z���}7ö�}J�H�y�����>�vT����?w��k�w�Z��o�R���V9˶@�ՙ�W�Q��)~�M�-�1�!b�6�T�c��_�d��k?�O��,��S�O<G��^,ҼMl'�/�C� <�$}E~~l{I�5]�s�]�i2������i���.?��O�Rp^!c!5��Q����Q��W�;�v��Kt�5�QA�n�|��Q\G��Q����u�H5,b9�,��kټ���a��+.�]O�0���#�7N��i�g�� H�����>��Db���هb=�-IR8#�E}k����~.���V��;.
�];�� ��5���*Ou����y%L����_�������[x�çK��~�`�/c�+�<���W'��i�߫	q�<n}���H�r8�|Vm���h/vZ� ��w���2� gUޥ-��� O��?����_��{,� fL��W�W��?�W�^��W7{y�{��¾B�+벪�sn�?���35���'�/�� �Ϫe���᛭i7Ib��ϖ��kۼ����z׿��"��_lW��0����_!���<\�������x'��D#'�Sn/����?��D�c�v�r~�:a�"������tE�=VU��kv#Ө���
�l��������ݡ�g࿳�z�b��פ��O��x������k\۶z���^�w�Z�o'1ʅ{�_;��:��u�0�
�8ߏ�_By����b�{�����3���OB��|�-?C�oim���R�q�����TӯO�-����J�z���h%t�����Xs^q�W�'���O�G�cBX}Z�I��z�z.�5-"��[p�%|�Er?�����z�@nx� �S��~��?tG-��q�t� �j�lF|�yU"�2T^u�e�3���fyU����������.����b=Q��F�(1_����M;0O�N���v�B���:�n�F�@j:�n�F�@j�*��MtM
��n.���lQ�Sv
6
Q���F�MtR{	�ĔSv
6
c�u݂����u݂��������T{���l+�\u݂����:�n�F�@j:��y��)��sR��Sv
6
c�u݂����u݂����#���m�l���:�n�F�L5E7`�`�5���t�A��`R��}݂���j:�(�0��( ��(��`�S��`�S�	QLaEPM_���j��.����c
(��
(��ݧSc���Ka-��(�0��(��M(�)�Q�R�.��E�QE ��N��jLOa�QE1�Q@Q@?xS���
u$ ��)�*�	��,c���<*�m�%�.����:��E��i^�;���8H�E�*�y��	|m�^��4�Ɵ��k�VNy/�)9_[�<=���������oį�丩/�k�����k�i��y,�ϑl��⼖���_Lk������ �W�c�漏����g�h��ܛ>��+�_ڂ� ��^�m��m����� Z���+�/�s?�Y�s��~���e\G7d�ۼA������(�������?�����u��\L��:
�:���>��ᾆ��x��f�\�sQQ�?9�悩�ԛ�0�H��������_��PmW�����[�l�d�����Au�}P���9� �M|/#����I&�r�\�r�=�*��-�����R��`�18 w�S�g�X�R�Y�2.�\��qҽ�Յ%y���2�ni7'6��C���x7R�V�l��1�$^UǨ5�W)+��*�*�J�h��n���>xk��i�3�̗�����Є�$�0U���f==e��x�T�y�+�2�_4�Z�=���4r����RO�Z/��������NY�`/�u �'�~���̷��4�d�F,��$�^��H��,&��m�ɯ#�W.�ƅ��?.��x��t�){�y�~� ��+�?<
k��S_�'��đJ�J�F�$BYN5���_��_
��pڅ�"�ս�@�S��u��|pm�EH���s<k�o����
�'����_ܫ���'�V�,���2������,xdxS�:��.����-�}��W�ߴ����i7�0d��c�A�|�:U�z4~��5�[ާ$�OG�Ҿ��A����Uö�R?&C���_��� �6�e����<As��3^�iIT��f~q��%�͝���֫�={Y�]WI��q�g�������ll�-�X�d��+�/2�)��h�>9֡Q��-�re)��'�x��^��[����� Fg�f���i�Jpb�F϶�����Or����+�5b�pAȯ�|3w��i�� z��:*�j\���9�3���P� ������"� ��Ę��̒�:�.������u�!��p��+�J���-3�����S�����=k�i���e�8Y�>�#�k�2�<�pm�$i��0��W�~ey��j��G��w?i�J/���I�8~�V�?i� ���>ሯ�{����$���^	^�L<��RT��B]ZzG՟�u����N|���s^�dȯ���	𶦄�\���o2�cC��o����W�rL,������>�U���I���eÏ��Q�]?����k�8��� :�J�*n�O��R�S�X���JK�lD���j}�uZ��[QLaEP_�U�����_�)uQh��c
(��
k��S_�'��è��c
(��
(����:���:��QE�QE ���N���j]E�uQLaEPEPc���lv�Il%�QE�QE 5��#��J:
]E�Z(��(��(��(����O����O�$QE1�Q@5~�S���������)�(�� (�� lv�M��ө-��
(��(���4����iGAK���ESQE S_�:���1=�QE�QE QE 4��N���)Ԑ��(�0��  s�]�����o��G]�������g��� �Q� 4}�$⼏���>���?�^�:W�~�?�(�� ��� �Mxt)�R,���ֿ��V�_�8W�~̇m��{�Q�ׇ׷~��}�X�ؿν\B�&��~	�������Ϡ<��K���{�� �+��S��%�?��ʸ0�Q�#��ȅ��~L�+�/�Ž�?��5��}}��I�� \?���dy����ͥ�׿�����+����{w�F�$o�~��ǈ� ��� ׻� #_��?Z�yT�����m�_�:��Gs�}9T<mr�Sߚ�4I�+�_�� �=�����5g��4��xcʰ8���_�<w���7�4���5n
�+�z�+��� �gL� ��� ��εՅV�����������2���� %{ϙ^�3}�g�^�^v&	�l����Y�{� Jg�?�w�mH� �������g��]O�ʸZ��+B+��j�� �m�� �6QEjx!M~��k����uu� 	%h�"�N36��
�>�D�� ��#QQ^y�N�a���� �#�/2�O����� ��q�W�W���?�ѿ�� �5�a��T��.4i��E� �#���ٛV�%�����eU'��+�*ޕ�]藱��N��r���է�`�3���sX�e�y5f}�e N �_�O��Q��qn��y�t5wU���Z����6\1�v��qD�$��z�\�l?�m���ǋp��Xl$�]�}�k+_�W�>����z��?�|]_fx�D�#����R�G�(�<1v�bo���� �<���m��1=k��ț�׳� *����X��:��������_��6;�G�:k�2�B�A� %F� ��� A5��c��4��>��F��+_�� �؞'�N�Z)��8�x{��3� /�t�+����I#��;���{v�����?fI
����B��tW�y��_�?������_�W�י���V���1��5�?�)� �X |D�q��rG�u�?�����Ȟ��S���\�� �c�� ���"}�u5>�:�lx�`��)�(�� k��J�tR?�4��E.��-QLaEPM~��k����uQLaEPEPO����SO����R
(��(���y�����K�����)�(�� (�� lv�M��ө-��
(��(���4����iGAK���ESQI�zѸz�p��Rn�n�\.-������?�ҟL,7�{S�ZW�M�֍�֝�qh��=h�=h�\Zj���=i��ssJ�E&��F��N㸴Rn�n�\.-�����+�ď�ө��oZv��Bz	1h��=h�=i�w�M�֍�֋���iGAMvO4��4�����)7Z7ZwŢ�p��p���qi�ڗp���9�ؘ�)7Z7ZwŢ�p��p���qh��=h�=h�\C��:�XnӷZHW�M�֍�֝�qk��:����ι��ַ��� ��D��^����fw`�e�G�G��q^G�I���l���&�t+�� i><!c�� /C� A5�ҍ���>*�|��������>x�_ �k��ү�4`�W�{�%�zѸzפҒ�?�0�������i��3���ñX4��<�8������>#�g�.�w�\� ��}��v��zѸz�p�l{�������.X�VW�-}��Ž�?��5����_a|(�����5�!^(�e˘V� �܍����j?��� ��ĭ��־�� � ��� ^�� �����n<��ë&v��>j�_I~h�>���� ��������|{��� /K_d��${>O�_�k�G�����,�����Ҿ���8�Ɨ���?�|�z��t��w.l���#ݿf_��� �+�1^�1�[Z����Z��l����r�t����|���J.��_�\-w_��>�����=k�
?���|�� �/͋E&��F��Wsĸ���K�z�]��oA1���h�w����m(r=Gz��=h�=hvzҫ*5#V�-5ꏲt����4���R��Yd`���W��u��e��B��N:��%�ϧ�yP��(�=k�c	s&~��q�37�}JpQN��u�娴Rn�%�^N��K+�* �&�.~v�vDG�`�S�sP�'�4�o��i70ہ���an��F�hUþZ�q~i��Z�;�C�(�#����W���}��!� n�� ^�������׆����?¿1<z?��?�ٿ�|bz���=�F����ʾ/,3֌:�c�"|ؼ?�_�u�	�#������|�d��_``W�qN�J�F�e`yW�i?�N�a`-���v��9�}h�O���^�KB�t���J���u���~N�ny�������<K�� jo}��e����@++p���ǒ*'�qg�2����Z���%�A�̣�$���|/��+��^+�2s�k� ��� �E{V+��o6Ep}Kdxu�� ��|�g�J&�� _\��]wŖ�&����5r��z�Q�ӛ;�����`�v�LFzӷZ��<�Ţ�p��p��q�Z)7Z7Z.��_�)��i�X`sJ���u�����;�qh��=h�=h�\Zk���=i�Îi7���)7Z7ZwŢ�p��p���qh��=h�=h�\C��})���x�;p��q!h��=h�=i�w�M�֍�֋�Ŧ��j]�֚�774�!�Rn�n��;�E&��F��E���I�zѸz�p����u1m�N�=i'���M�֍�֝�qh��=h�=h�\G���t�a��J`sK����)7Z7Zw�h��h������G�G�-��=(�=)h�,0��8�N�=)��`�S�		�zQ�zR�Lvh��h������G�5Tnn)����HB��m��S��=(�=)h�,&��F��KEa���Jv��IݧR[		�zQ�zR�Lvh��h������Q��J`qC��J:
]DG�G�-�a6�J6�JZ(	�zSX�)���I���zQ�zR�Lvh��h������G�G�-����Ґ��N��&��F��KE1�M�Һ��?�6�8� ���u�]��|m���:Oc��*�������8�"��|!c� __�)�^ b����� �B�����S\�����&�|�����正Ҷ�!�������ݾ�/��Z�� َ%:����5��t�E����`i�9�,5_�O_D���,�����E��.|�L)>��Դ�����1\B�Oc_t�Wɿ�X�#j@���s�����\[�`r�4188�٫�}7�����Ҿ��N�+���S_��	��[���SEEte���U� ꍿ���������'���Ā�?�� ׻� �&� =M*J�:�A�5\?��4t�T�{�q� /K_e�5�k� #�� _K_f`R���[�������G��� �1�� ��� �k��Ҿ���G�S_�}��q�)�D��5|��ߔ#ݿf 7k_�
��W���]u��{�c8�G�<!S�&����xGď��ߊ�]y�Z4	q�;`��_��ğߵ� ����
0)�I+؞ʱU�^��4�o^��|�� ��O��� �T�9�������}?�F>y� �NO�_����g?~����?���1%���_P`Q�K�B� Rr~�� ���0�9���������~$�����_O�Q�O�C� Rr~�� ���0�9�������s^6�a����m@��;_,�3_b`W�~ӣ�$�/�w��2m�xY�
���&��4R�ߚG�G�{�ՠ�]\�z��+���,3�<�+�k�� f!����T�Us�O��BY�u{]��٠��&�DW��Xd_|GѠмm�Y[�Xc����_g`W�?��k_���VT����OJmj����������G�Q�?�{'���/ ���4��O�UQ]#���\��� �_��=�Fk��� ʾ-*2x���z�!���{?�OZ)+!��.lU��=�Ws�z����>)�,���
�ܑ��c�v�υVQ_�@�a�C�f�T��$W؁@)͵��p�a�zU+�읒Zt�χ5���ڄ�Z��[�'Ua��U�ҽ�����F�v	��e�R��������_�SuY�5s�Oٌ�]c��� A�x���� ����� �"������� �*r��u�� 6|w�h�]��^��һ�_�Qu���j�J�[#��4�]� ~_��6��m���i��ǖ��=(�=)h�;	�zQ�zR�@Xc��x�UP� pү����6�J6�JZ)�a6�J6�JZ(	�zSYGS�ړ�L]�ҍ�Җ�c��G�G�-��=(�=)h�,3h�8�N�=)����Rh��h�����&��F��KEa6�Jj���S������=(�=)h�;	�zQ�zR�@XM�ҍ�Җ��A^���Ғ?�N��h��h�����&��F��KEa��i�(�����t��چ��F��KE1�(�� (�� (�� a� X>��a� X>��BAESQE SW�5:��y���(��(��(���i����:��K`��)�(�� k��J:
G���t����QE1�Q@5�S��ړ�uQLaEPEPO��i�I(��c
�>����:��择>��Z_ ��ʲ�4i�U�9l�s>������HX� ����k�����k�dwI����+md=��~=�G��;��:d��w2I2�-� *l~���yUE��+=�<v���a� ��g���u��� ����:��?-�˛Q~��>��|����J5������,Wɿ?����ʒV?E�I�e�_�_�<����L3��C� ����U�/�6Y>�NG���i�s��"\�ڿ��Q��A� ��� ^�� ���x�5���c���p���O���o�~�����3�C�_���4� ��B� ����q_|4� ��B� �����↮z�>\-o�~���h�/�� ��� �k�
�C���� _G� A���c㸺\٬ߔ#�?f�ֿ��X���[Z� �W�b����;��r�4�����S�F)r�Y�F����W?�Z�@�Q���;b�]�
�o�� �C⋷�k�m�'�*�?
|��f�K��Z�$�7�~��a�F���~%���Wi5��4�Z)����澣�y�o�){��C�h��[�(�'(�l>k'I'�}}�b�S�F)r�S�F�O���%��� �5�د���4m�����MF��q-Nl���_�>x��?f�k������ك�<5���ʩ���~|��'��3�q_ �c� ����_�_`b�?��� %#Z� ��ҒV>́����3����3������Wŕ���� �ZM�l����/�PFD���A���1���Xl]HՕ����gq���?��� ʾ+=k鿌��/��7iy}t�^"9;�k�J�q�.�'N4��*��l���G��� �M}���� �����������8���O����_��៴� �xh���O�+�������D� ��!_>�J��q[�ͪ��� �(��aѵ���_�W��b����Z�Վ��M�����k����>�t绗S�E�R'���K���W�XheT�*�8^�v���0|[� ���� ��W zV��5���o�7M��&=2k(��?�T�lMZ��Rm|؉�i�����Kc�lQE1�Q@�iW�G���~��]E��)�(�� )�ڝM~Ԟ�{��)�(�� (�� i� X>��i� X>��BAESQE SW�5:��y�uQ�QE1�Q@Q@��ө���u%���ESQE ����t��M(�)uQh��c
(��
(��
(����>���>��QE�QE ���N���jB�:�(�0��( ��(���u6?�N���(��c
(��� tҎ����.��-QLaEPM~��k����ESQE QE ���:�~�RB
(��*[[i/nb�/,�Tw&��۲"GBE4}�_F�w�k��j�SIx���C��^c�W�l��x�7:}�"9r�����Z��+%��(,EX����S��t���ou���ׅ׺��������Μuf�:��~��>��|����J=������J�/������ �S�UIYyų���y~L���߆�|dt��s{��Y2���2�=+3��&2������z��/����I�M�mZ��a�Wv˰��#��ݧP<f;�T���]�7�?��/��J�?��?����J�Dt�"�~�����U� �x��8?��� ��� �5�u}#�N� ȯ���� �k��+3�x��fr~K�=��_6��  �}�x�����{�\ct~�Ó��)/_͉�1KEW)����� ����O����w#���"�����<m�mu��2D��־O�����H."hf��dq�e%f~/��*C*��ek?��E^��1]J��n	0�
�v=k� �K��(�����E$��� ~���K��٨^����Wf|7B�L�a�uo�����1KEk�~��D�x��@?�M�� �w� �k���j�h���� ��F��� �|���_�>v���e� ��ֿ�*���������Z� ����"����i��t߯��s�|{��JF�� ]�}�_�e� ����_�U%d}�ϛM{�g@$t�+3�@'=h�� �>� �I��� �M}���������������u�U���O�Q{�G���<Xh���O�+������ ���I��|�S%f|o�lΣ���PX���(�>\)JZCҀ>�:��v�Il%�QE�QE 5��_�)�U���Qu�(�0��( ��ju5�R{	�:�(�0��( ��(��`�S���`�S�	QLaEPM_���j���]GQE�QE QE 6?�N���iԖ�[QLaEP_�Q�R?�4����]E��)�n� cF� cN����n� cF� cN��CQ�����:�5H�|�ҝ������O������4o�4�)�=F��4o�4�(�5���U�f�Ԕ���KQj����:�z�Q�����:�5F��4o�4�(�5#G�zv� cDv�I^�W��ѿ�Ө�����ѿ�Ө�Pԍ��<P�+��J:
Z�Z�M�ƍ�ƝE=G���ƍ�ƝE��w�k�NZ����;��� cF� cN����n� cF� cN��CQ�����:�5H��ÃN��h?xS�+�Q�����:�z�Q���t?Hoh`��v�~��]���4?�����W�:0�Ǉ��϶ �w����}�#$]�� |��0+�� i���?��� e5�R6�?^�*_Uy1��5�߲�����'��v��?��Z� q?�r�W�?7ȟ.aM��L��H�������'�q_$|{� ��}��*޴m���|�8��/ɞs��׹��'c�=gZ�$s��n�o����>���:����Ɣy���p��#���J����>'|��4�KCG���L�r���=���ƾ��0χu G�����k����N�9Z��ah��BTc�̝��CW���z'�t��A�]�������}R�+�YRx$P��r|Z�(մ�6���6$�
�K�s�'�^X�	G�/_��� �׉��M�!�e��C4�v`�^��Գ�Iu+K4�,�r]�I�TI�;�Va��?*�V�OC�e����5�|��1j"�V�q�@G��Ҿ��u�W��g�_��]������1[r�E�F���1�x�Y���`1�����5��a�^�1�"��?@k�{�����7ޑ���s\Օ�����ХIwl��G�7�]��������a$j˂��	��n���k�?�O�]Ҝ�-�������~_kI�?�բ��1]\���Q��ߵ��裿��� �x���j-D5�bJ�J��'�Eh���k/��������k�_�l���� ��������[� �o����ji�#�r˘S~������v�ĝk��k�+�|W�?������Vգd}_O���ќF� cW��Qץ1��S]��"\�W���;i�xL�"Q,�	e��ݮ|fU�h�p����>F��=GA�G�X�h砕q������|;k��S��S,b��
���������Ք#+������g�V����?�	���㿃?�R�O���_cb�����^|�Y��~���ڐ�O��� ��!_<��5�?�H?�4?��'���cUZG�g�0��?$7����@�G���C�&��ht�lYz�?�+�5���÷zsGc�Z]��%/��(�)I]�\�������/���o����j���M�j�Vl���{��zVVg����{��� /CN��hO�N��bU���4o�4�)�=F��4o�4�(�5#vʞ(l���iW�Z�]D��h��i�S�z���h��i�Q�j7�������)�ړ�������QOQ�7����QF����ƍ�ƝE��e�q��N��h?�ҝI\J�w�7�u��w�7�uj���i��3pjJj�楨��ƍ�ƝE=G���ƍ�ƝE��w�7�uj��|�;��?�N��a+���h��i�S�z���h��i�Q�jF��(~���-n-n&� cF� cN����(��c
(��
(����>���>��QE�QE ���N���jB�:�(�0��( ��(���u6?�N���(��c
(��� tҎ����.��-QLaEPM~��k����ESQE QE ���:�~�RB
(��º��<����ι��~��� ��Ϊ;�zŇ��϶�J���s�D���� �M{Z���s������kԫA��f�/�����+�� e���ֿ�O�^^��-����:ࢯQ	�>\m7��B���?��� ��ʾ��־F��� %*� ���U׈V��9�Nl*^k�g�Wٿ� �h_�����ʾ��D?��h_������&y=.\Dߗ��Ƚ�׻� �&�o�~��W���Sڗ�{���k�V���U�Vhۈ��:~���v���x�O��qXeL������+�O�ֳ�襹Ee�����b�Qj(� pE*��<��.��R�Wd��Z�����P�{k��?QTk�ڋL��#I����/�J�8��+*��r�<�va+ʒwH�~x��_��v��yr� ���J7Y�WBX�E|�
kꟀ�S��M2�Q��d�pO.���[���Ϡ�1������U���Z)q��Z�9O����R���w��������Ҿ������\�~s@�C����L�W�:ׂ��R���O�2��-L�}��1wO���jT��ݵ�J���N�����N�&П���Zo�u�V�H4ۓ,�wD�~$����w����1���v�%#�c�
Xx�k�B2Ԇ"S��k3���Z1��C���j5�U$� �_|a�8�O���#m��"":�f�����?�jKKy����PyE=Z�Jf,ē�y&�1_
>+?ƪ��h���W�߲�������ʾy��� e����� �*Ƃ�Dy+�����G�W�� �k���W����� ?�k���WV%Z(�> �6+��g_n|>�Eh���ʾ#��~���o��O�Ya���;�e�V������� "N�� ^����3־���?�ֿ��� �|DzщVh8�\�i�����)z'�u?�	��+���R�O���_d��Z���G��ˇ���������B� ��!_<��� �7���/��'���sWV�Ϝ�_66o��G���� �.�� _� ���*���k�@���|/��+ܱ���1���MN\5�n|c�xc�F�� _-\q�]��� �):��|�q��y�����+Z�=_�"}�u5>�:�[�`��)�(�� k��J�tR?�4��E.��-QLaEPM~��k����uQLaEPEPO����SO����R
(��(���y�����K�����)�(�� (�� lv�M��ө-��
(��(���4����iGAK���ESQE QE QE ���})����})􄂊(�0��( ���ju5~�RQ�QE1�Q@Q@��ө���u%���ESQE ����t��M(�)uQh��c
(��
k��S_�&'��(��(��(���)����:�QE��|;� ��C� ��� �s��|;8�·�?���up���*G�n�+�?i�� m��}� 즽�x��?������ �M{uթH��}K�f���k�?e���ֿ�O�^^��,`�kC���u�a�����]�P���د�~>� �K�� q?�}{�������C���UߋV�}q>l:^g�W���[}��S_��?0~hX� ���6^o��2Yr֗��nx��=�׻� �&�o�~��o��<9������&�o�~�X�g\�\҇��:o��Pt��J�c�?�> �?�����8�pj�gNK>ZS�<S��� �[J� ��� ���5���I��m'�����_4W&)Z�<���b��C_���׈�|-���6����هp}�-��_�+�;;�Ɍ�d���wÏ�Zw����'Xo�bkby�z��_i:��{ݍ��\Fr���>��bh���W}��܊�ibc-'�>�	��iB���F{�)jNJ�}�c��6мA
�c�[L���#[`� �=�w��ǻ�J�w#Pr���9��$�汵�hz-%��m ��O�(i-X:�*�v5�\����o�t����K���S�9�����ߴ��1Im��s,��u0��W�kZ���o��.^���K9��\5q1��՞/7��_~����x�Y�Q�����{"��袼��wg��Nm�N�}�,�?[� ������#�W����5?�tᵪ�O+|���_��|W��?�����W٘���4�~%�� ��һq��^���Ϛ�W��q5����� N�� ^���������to��O�X`���,�\�'�7�� �#Z� �g�U�	�_p|C��F���� �|>zьV��\�!�v�� �h��� �&���|m�\��f�� ]O��k��V�5x?S�&�-z���_ڟ�<4/��'��}�T��� ��!_;W'J��3G|T���}�,� �Z� ��� �E{�+ÿe�t]h��� �"�������9uKa`��ϋ�0�I׿�嫍=+���� %'_� ���4����ω�kZ~��>�:��v�Y-�e�QE�QE 5��_�)�U���Qu�(�0��( ��ju5�R{	�:�(�0��( ��(��`�S���`�S�	QLaEPM_���j���]GQE�QE QE 6?�N���iԖ�[QLaEP_�Q�R?�4����]E��)�(����|�Ԯ+����{Q�{Qp��)�7�7����>�;���)�7�	�1�S~oj>oj.;����{Q�{Qp��j������m����%ߛڏ�ڋ�㨦���|��\.:�o��G��(�\#���7m�N���O@Luߛڏ�ڋ��QM�������\�Q�S_v�Ҁ[�J���E7������p��)�7�7����j>ojk��CboBJ)�7�7��QM�������\uߛڏ�ڋ����N��m�N���&E7������p����]>��[l��u>���{Q�{S�Ӷ�������s��uU���������'���a~"^AmgC�ڒɿ�;������ۏ�'��8򳾮>�j~�OBJ��B��߈>���f_.x��z�z��oj>oj�2qjH�RT���m��#�x4�������a1�����>)�Ǌ���R�nv��GaY7�7�mR���H��c*�RS��n�?�����:h��I�xI�g�n*b+��oj�t�J�才D����П�h-;SЮ4�e��T��H�B�|Z���M�z
w��EJ���!����˚�kM��K���������_M�����֙jbkK�_�7)>ƾZ�������W�/��>.���OH���S�%�Z����Ę����5�4ߛڏ�ڳ����#
�eZns݃��J�tS[v�҅݁ҳ��7�}ߛڏ�ڝ�rX���l:8�k_�JV� �����������إ7��u�Mv�Jͫ]�=��X��6�di�K�>ojk��JRoqJr�쒊o��G��J��)�7�7�����'Ķ�u��$��.@Y�z�t"��ڏ�ڮ3pjQ4�VT����N��Ixj�Ny,D�We~H�=�>�f�5���^�Q�9��C#~5�wo��ڴ�^u~#�������u{��o�V:�������lW��^���O�ڏ�ڦ�YRw�1�˞��Y��c�hS���p6�q ���^M�������VU]���K����k�X��m�'��H��j�gG���3u�,�����/�Ǹg����7�4n�xT�Η�^Wu���%��]f9"��al
y>��M������9M��3��YU���g��"����i��4�}�T^�G�
��k���ݮ��i�{���$L�@>�V������hbgN<�죏�B���RmoT���;�����ܚ�zR|�������8m݂}�uF����ڒz	1�S~oj>oj.E7�������p�iW�k��zP��:Q}E}G�M��������:�o��G��E�㩯ڏ�ښ���RoA7�%ߛڏ�ڝ�q�S~oj>oj.E7�������p?�ҝQ����;���1&:�o��G��E�q�S~oj>oj.M_��|���-���+�QM�������wE7�������q�S~oj>oj.��:�M�{S�ojI�	����{Q�{S�\uߛڏ�ڋ����5�m=(�8���E7������p��(��(��(����O����O�$QE1�Q@5~�S���������)�(�� (�� lv�M��ө-��
(��(���4����iGAK���ESQE S_�:���1=�QE�QE QE 4��N���)Ԑ��(�0��( ���4�j��K���(��(�����=(�ө��iԖ�[QLaEP_�U�����_�)uQh��c
(��
k��S_�'��è��c
(��
(����:���:�
(��(���xө���.�c���c
(��
CҖ���O�N��ݧR[	lQE1�Q@�iW�G���~��]E��)�(�� )�ڝM~Ԟ�{��)�(�� (�� i� X>��i� X>��BAESQE SW�5:��y�uQ�QE1�Q@Q@��ө���u%���ESQE ����t��M(�)uQh��c
(��
(��
(����>���>��QE�QE ���N���jB�:�(�0��( ��(���u6?�N���(��c
(��� tҎ����.��-QLaEPM~��k����ESQE QE ���:�~�RB
(��)�[�u*�o4�p��I?@)6�����ƽC�� ���Y�m�=�,2�v�X"������/����o��|�~$���䫊��_���+�UJP�&���;��w��)Ks�=�J2^Ѽ�y�ż��4S��ʧ�)R?^���ǟV3^M?�䭇��|����Ո袯�:���[}7M�k���jF��vNq�9�%�1�\��U�(R��&��<w�}�Y��(�|�A&�A��^@�T�ApA�c��`烪�����7����j5���q��i�������*�(�~�q���iiOs3H�d�5뗿���t�=�.<ƷI3 �OZ�qy�(�Z0r���;(�+�S�9%���tS�����JH��)�D�H�ƥݎTd�^�ծry��4��Ez��+|C���dV�J2�s6����?c���ǝ��𯛟d���,\_�G��$���ތ�*+�O�y����� ��� 
�a�W�^V�U�gKu�<Cz~b�0��U���C	I�RW"�]��j����8z(����
k��T�Z}Ωy��/qs+H�,jd�b�vH,ވ���]?�H���ZGp�u�!�BMp��b��|G� �;/�
�_8��%����� G���{WTe�3Ĩ�m� �<��� >v_�?�cψ� ��e� �C�*�|����� �H�8� ��/��%Ezg�g_xKmGR�Q���m'��z�+����c���~�QN=ӹ�[W.J�q~z?�ҝO�����+{x�i�;R4,}z��)|E���M.(VA��L��b��fX,��Z0���+���&��V�y�?��_� ���� G�R7��T���S����y��6K� At� �$vec� �̾�x��������m�A� \��?1\�{�14qP��&�馿ϩJ�rԋO�@���4�j��[�1c��R����/��G���kM��K���}q^2�N��-f]/Y�k[���Xz��W�G4��1�ѭT��M]��b)SU���v�¢�+�9����G�o�ş,�ҭR;%8��j����,^7����(Eun��hU�O�ы��6O�N��ǿ�߆z����_"V���z�\�k��KJ5��J/f�L�t�JN��(���(���4��E#��J�tR�.��E�QE ��N��jOa=�QE�QE QE 4� �Ju4� �Ju! ��)�(�� )����M_�Ժ���(��(��(���i����:��K`��)�(�� k��J:
G���t����QE1�Q@Q@Q@?�ҟL?�ҟHH(��c
(��
j��SW�5!uESQE QE ���:�ݧR[	lQE1�Q@�iGAH� tҎ��Qu�(�0��( ��ju5�Rb{��)�(�� (�� i�M?xS�!U�/M�W�m쭐��w$Ҕ�S��E$�쎏��M_�v����v�ga�ľ����W��?��h�c���<���Ϸ�I�cᥟ�[Y���Us69f=�
��?⾓�Ck�FM�0�6�~i�+���8��X��e��W�Kyy�/-���6S�a�?����{G���āF �Ϸÿg��� ��f�<� ���0��̫��v��֧o�y��n�f/��y���9����*�5,Mx�O�W����_�0���F���{����8#޼��'���B�/.�;]V(�⺄l��}k�? ~�^1�=�Jo�S�S�[]��c�W�x���:ǆ���tw���3�,��ds�W=>�r�u9�e}~(�[�?�S�\A�c��X�m>��?�c��f���ݎZ'd'�q^��/x�M���k�"��bI�1�k�e����s�ܖ'Ԛ#���]���#�5�	��,�S	Q�N-6��ʰ؇��
�W�w?Y㺀�m�'\y�S���"���^ҡ'F�b]Tq��C^��0�p2������ �7�LF�y���(����t;�/P�Mmp�X��W�.[W�Y���^��]%�~k�?h��p�G�����>ϳ�O�d���2p95�|Z�e{��Wt��h�Z�lp�����k�.�?��U�b#E�`�p�Wҿ�k�L>�E���u��/>���r�MlZ�(������=_�N�4�x�]��� �H3g��/���kX��4����V+hc,�ǀ1Q�#��"�DqF�UG@��� j��'Z�
h�� ��ҥC����J�l����=Mߴb�/�V~�W��7�Yj�w�����?�Vڿ�5{�1��{�x��&�_ٯG�־.h���%�ɵ�A#�yuz��v�`�ϳ*��� �d��M�4�]�V?"˿}�Rr[�~g�b�@ p ����UI�A_�_>#������wp���R�UPx����-S�+N�&�ʮ�W?h�3Jy=8�pr�v�~�����P�@��F�D��2��u�ψU���G?����_P��?����sZ�{ґ��M!� ;_G�x{��p��B����$ӷu�<l�����DpҦ�嶷G;�P�϶�G�G���왿ҭ�q?�=��J�E�v���J��C�<��~b�����ݷ���5�og��ؗ�*V�{�����\U�S��#V��g��+�� c=�Q��=��K#�ۗ�p�ּ�����o��/��?ξ���I��v|��<\�*y����������mb������8x�fS�~n���7�u-z��]j�{L�,� ��5��ü#S�]NJ�
�^�����9�<�C�NW�m�ӿ;ޏ;޿,�8���� �!�Ə�N<C� A�� �o�� �YW����� ����ʗ����⟈��������%�[��������~cܺ�s+ �3���f�j!��d	{�\� �JX~��_��.�R�<��zYi���o��RP�Q^��/�� E��~*,�Q,��$a�@oZ������� cF��.�� ӫ:�b����%S�$l��~7�9V���F6?D�:ie���L������?�_�Q�x�R�Mn�I��T��� Y�D�4N����e9�o�N�����I�b�_�� ���4#'E����A�����x�a�A�E|��D��V�gs�?
A��2\X��H�TW9�7���m5�]��&��v�̟~2zd�����H�_� ���[6�|�-KG����n�nP�l$��_|Y�P�Q��!���63�L��J�O�;����=�v����" =EyR��_��,]<~�*��5s�l^xJ�=��~���f��O��;i��[°��F��7��v�⟅�[tT֭���r����?�����(��v}&�\Þ �����k6�֟��5��NA���ܣ����a[�m�/���G�yN'����+5�5�n~[j:}ƕ}=��M�,Qц"���_�_��C'�tX?�f���ޯ�<9����v�]�-5��T�濠�l��`V2.�^��V��~�噖W[/�<4�﷚�u~�|T�d1+%�d=���W��k�c�z��t[]/O�a��@��1ӽq_���-�"���3����.Z|-��%��)�������� �\�ř�p�D�4������G�NYK#����V��o/����t���#H��]B�s�W����V��ֹy�=R�Q�����r��sɪU���K&˩`��ʵ~oW�?%̱����-d��
(�����(���4��E#��J�tR�.��E�QE ��N��jOa=�QE�QE QE 4� �Ju4� �Ju! ��)�(�� )����M_�Ժ���(��(��(���i����:��K`��)�(�� k��J:
G���t����QE1��޴moZu�+�޴moZuX,7kzѵ�i�Q`�x�;kz����O�a$7kzѵ�i�S��7kzѵ�i�Q`�ݭ�M �njJj��aX6��[֝E;�v��[֝E�޴moZuX,F���N�޴G�iԒ�I�޴moZu�;�޴moZuX,F��<Ҁp9��iGAJڊډ��h�޴�)�v��h�޴�(�Xn�����9�)�ړBh6��[֝E;�v��[֝E�޴moZuX,FCnӶ���
u$�a�[ֽ��P�k�R�uCa����������`��z����b�5�\KRTr���[�v>��p��f�a-��\����-m�C��K}~x|k��u��7�o3H\�oxU��>"]���������~p�Ťf<�I5���R���������q�"pTp�gv�[�oZhq椦��5�%�����F���QNðݭ�F���QE�Ƈ�5��k6����ͻ�V��Џ�l�&xZ�V� K�{�z�~s�u���e��O�y�Y��.!���\O���p����a����y�]ù�ʱ��志���s�E�i��N�c��!f��rK����ǅ|9��7D�Ҵ�D�.w>�ޓJ�`�t�k�f���X�}�� 	^j�|΋�$�󞂿�,]um���~G�s���͎�KMe�p� ��Ƶ�6��>�0:��ʞbC��k�����W�I��3rI�_������֩)��w,rz�VMD�%,�
�GY�d���G��w��6ĺ�H-"��͍�޵�?��W��I��ʼ��W�fm�t���ʻs��-�/�K�9�u� 
?Ŀ3r��+���߂5�_�Z�m*��[��(Ք�9�@<�ks�U'Ԋ� �jdUgRԹ�����u�G9�
r�/+��?4G���p4�� ��d� �ھ��O�=Z���������S� �4� �E<J ��}+�3^-��XYacIAKF�}>�x�oQ�bc��G'����C�}b=�ڍ��8`v$�+�7Y�:��yrL�?_�:�o��N��s����������~����.rL�� >�����yգ7j�����O/��h���{�7����_C~�$��5O��Z����o�������G�(�//�ê����a�*�zM�1��$,�=ȯ�� x#�:��2���f��waױ�G��i��䢓�V����B�rSRS�[l~˝��s�i��ߥ�?4��?�� ���χ�[8��u���$�~$W�#� �i� |���i�Z����V�M����W�ǎ�]sa�� ��%�Q�����'�>���kz�S�3J��|u�Y�m"����s����8Ԏ�'���֤�ԕ9o��{��tJ|I�$� ˫:�;U��%���� ���d6�����O��'/�]*�����_��|��'�!�?9�~!뺇?��� �����Z�%�Kj1ʅg|��f��q�G��U�J���b��D��e`F=s_�������4��浪�Ҿ�5��T�� �me{i!�ap��:���=k�+D���(#c�(� W��y^�"Tp�w�nߕ����`kB5q3MFVK��O�� mtF��)�&�f�bPwkڿjoG�O�Mk�!�O+#�������}� a��p�罯����U![4�(m{}����k��s�{h7i�}f�636-��� �o��+�
tR�2,��NC�ף�e�3l,��֏g��h�˱�r�Dq�ۮ���7�yn�H�,2.H�`k����x^��4�#��$�����v��^%ԼE��N��y�
+���t5��u4U��˪V��m+�Vz;єi��)�Ÿ]���Ur���[c��
�U�%X��B����=~*|G�>&x��S���+9���_��<Q���g���ik����� J����ظ7"��ì|��֞K��S�.-�g�ļ4��o��E8�N�޴'ݧW�Ih~x�ݭ�F���QNðݭ�F���QE��n��(�W���~�mEmD�޴moZu�;�޴moZuX,7kz�\9�RS_�&��moZ6��:�v��oZ6��:�,��h�޴�(�X���sڝ��h?�ҝJ�Hn���kzӨ�a�n���kzӨ��a�[֚��njJj��aX6��[֝E;�v��[֝E�޴moZuX,F���N�޴G�iԒ�I�޴moZu�;�޴moZuX,F��<Ҁp9��iGAJڊډ��h�޴�)�v
(��(��(����O����O�$QE1�Q@5~�S���������)�(�� (�� lv�M��ө-��
(��(���4����iGAK���ESQE S_�:���1=�QE�QE QE 4��N���)Ԑ����G���3��v��~\�"��|�9�'�KRC����w��x_���a��~=_)�,:�%���_����WT���f��?����x~��P�n��+��s����5�k_h������pz����t������=b�Q�}���Ŭ�:5�~M��VM,�NޔuV�o��暿x��cD��/^�P���t8+"������~������?��B\�VhusIѯ��ĵ����w8	��]���-�֓��y�� ������=�e<ERP��od��K��NUiSr�wi6���E�q�!��=(�o���q�Dgl�^}����q�6 �c\d�Z��ɷ�n�3�'���\��i���W��
	g�V�o�?�3$� Վo�w��N�(��O簯Q��ߊ�i�o�^]^��9�ߊZi�o�^^j��5��_�{9.���q�Ϲ�}�����>"~�>(�|Ya�-�����0$�;6;��ӯ7�����ω*��l0*~���_��[��W���)YiS�>5��jO7f�ס�?��;� ������ k���ٲ����3^1E~�����<~�~C���� �L��}��S�Z�Q��;��R�ǘ�~V���3x^�S��CKfX��ׅ~�%��ږ���h#���j�3�w�g�NiKw'?J��1�S�f���My>��9=J��Iώ��I7�w?;$C����{���|i��w���7�	n�qѝ����d���+� ������y|���?�� t���Ϯo���g=���H_��&��Xx�j�Kc�K{U��#B�rk�}rB�5���>��۪)]J�A�A���N��U�)�Zֹ�Oc�xa5Gk��mc�?�<w� =�� �j���P��T��կ �d]��+�k�(��K���P�܏ʥ��M<D����<�3<���G%���L�������ۿd����� ӱ�u�G��_��M�������e�Xby�T?J�_���Lɿ$A�Lo����o|�j7=Γi4��;D	5~ ��Ntk á�Ex~��[E�j�6��?�NPI$�-����4���^�>h[M�a�#�U���jd��
>�J\�����G6��X�a	Eͻm��h��Xa��EoC豮 �*������zT�}��q�L�U���s^�e�#=k�?�^�<+�;���y�/\�瞽�\�+��1�Ľ�K�2�n+,�s�#��� *��ly��ܷ�R�N�I�b�ǩ&���4�j��_��+$8ɶ��W���W?����t�f<��� �+���/|g�[i�1��V�"�&�����|��}2� �3$�ݻ�_-��G�Q���� ���+��ͫ�z��P���� 3��m �la��E���� O�S�����)^3�TpJ�@�^W����_�>�[HV�R� <���>�T�<���^y."�� ңf'x'����p<7_0��{>��L�;4�\&S���j� ���]?�`�_�mi�+�2�:����͎U�>����k��w�471FV��� �x�H��l��Ρ���ڼ{���F�)ӟ^�"�V�QG2����8s1�_S�x� ޗ�� ɞ_�1����W�Wv�Q� 5�#'ݧR(J�!���-~��?	
(��Q@�iW�G���~��]E��)�(�� )�ڝM~Ԟ�{��)�(�� (�� i� X>��i� X>��BAESQE SW�5:��y�uQ�QE1�Q@Q@��ө���u%���ESQE ����t��M(�)uQh��c
(��
(��
(����>���>��QE�QE ���N���jB�:�(�0��( ��(���u6?�N���(��c
(��� tҎ����.��-QLaEPM~��k����ESQE QE ���:�~�RB
(���V�+�������mf���g�W�?�,���,.R��A��s���t~���x&�K�޼+�Q�o�����:x�:Դ����8w��eQXlRs�Ӽ};�#�{��7��1�z}��� �D�u��~7>w�Dc��N�ʼ�A���"T���1�e��Ϲ�?�jo��}������Yne��)�%��?Ky�c�V�������X�|)��b!��[ُX����^�K���ڄ���S$=x�^�~����t��x�r�Ǿx׋�!�6�2j��*g�N~��0�&�ES��<�ǌ��G �ݬ���~���%�����b��<T4Q_�%ec�����-!�LGۿ%���H�����_w����qh�I�j��KD�R��B+����{�Eż�5���%C�������eu��~��ݻw�?k�g�u^XhT�GǗ�կ���*(����P+�g�V/��if;��Ҽڮ��΃�[��9�����4�z3����C/�G	�����������{�'��0𯈯��P���._�H�ɯ�� kh�c�4�\�ô2 �����?k=(���u� ��+�Hd��2�8�����.�p�.	W������z/�)/�����O��F4L�U�:� ��ҿ�	u� ��(� ��ҿ�	u� ��+���y�_�NO�^�O�  � �Ou�,-4kD���;h`$c W�~�� ��tg�����nx��ϖ��Z�_�Pjڴ[�����k�c�W�^^O�\�qq+M3����&�,�!�*�F+���_3帋�0��K�k̬�k$�$C^��)ʱ��� �s�^![^�u�u�}Nű,g�=w��A�pӣ�?1ɱ���
8��^���	�0 �j�5�^�.亸��^y�m�Myu��e��	�蓙��l�mϷ/�5��� @K�����_���3
-�qk���?��qb��z����OD� �%��� Z� �4�G� -���k-+���_���k-+���_��·��m�_����W���� �?�S{��/�xr�M2�4��c.� �:�X�R��H5�4��Ƶ�\YiZl��N�Y�6�
�&b�X��rM}fOGF��)����?+��NS��SyZ[{�+'�K#�?e������;�_WjSľ��d�ʾ�u���58S�@6�~�׷����Ӯt	�����FS2�jd~����]|V1T��c�xO>˰L��jr�-�w��>x�?�3{� ]���6�闐�[Hb�&��QM+O+��,�>�_n��yY�Ԧ��㦷>��5�N�A+����Y��'��[�|e�\��j-�ѻ_x'�W��`Ԭ��<�����K����Eo�i�AЀ��b�Z�^IZ�)U��/u���2�+�c2�Pͤ�����_�� |��Ϥj�VR�4d��5IF\��խB�MJ�{��e�˱�5Uxs_~�e͹�UN^wɵ��>�������Q�U���ʩ�w5񭟂t�J�@)ؙ�۰�_� i;]��i�Ŝ�In�X���"����[����ֶ���(3�����<����x����.����>W��І^өk(�}[���?�?^��_���d,�7ʤ���
â���B4�d��*՝z��Q�Mݳ�� |\ꋤj�컖<D��_[,�q ����k�#�+�>~����=7\�[��b)�<����g97�'��:����?X�(����s	������_�oëo
k�j� Gk|Ih�E~���E���i�%�@!��X[��F9b}My�}]
���H�,���cV��m���m�p��+�>|(�� k��J�tR?�4��E.��-QLaEPM~��k����uQLaEPEPO����SO����R
(��(���y�����K�����)�(�� (�� lv�M��ө-��
(��(���4����iGAK���ESQM�(�)j-GQM�(�(�5E7`�`�P�C��})�Q�})�-D�:�n�F�OQ�:�n�F�F���j��`���KQjIE7`�`���E7`�`�P�u݂���CP��Ӫ4A���RW�+����Q�S�5E7`�`�P��Q�S]�@A�K[��E7`�`��j:�n�F�F���k��`��);��ĔSv
6
z�Q�Sv
6
5GQM�(�(�5��:�(7
v�I\5E7`�`��j:�n�F�F���j��F�MT�-D�(��l�����lj��=)6


5A>�:�D�l��
㨦�l�GQM�(�(�5���~覲��A�K[�[����Q�S�z����Q�Q�j:����)���N���(��l�����lj����Q�Q�j�`�S�2�x�S�
J�WE7`�`���E7`�`�P�u5~�`��Ɩ�d�Sv
6
z�Q�Sv
6
5GR�����v�Q��킒��\u݂������)���� pү��@Ш0)kqkq�Sv
6
z�Q�Sv
6
5GS_�5�qI��w�%݂�����u݂���CQ�Sv
6
5@� �JuFPoJv�KQ+����Q�S�z����Q�Q�j:��y��)��sR�Z�QM�(�)�=GQM�(�(�5E7`�`�P�#���m�l��
㨦�l�GQM�(�(�5���t�A��`R����M�(�)����)�(�� (�� a� X>��a� X>��BAESQEzG��	Zx��nר%��?7�n���4��v	<v&j{���m<%����[�2����e�k5���<2��A�G��<'��A6�g�G$6ͱ����
�>,��¾3�墈���(��cޕ��x̟/�N���W�Otկ���<r��S���*8 � ���(�-�OȚe�#�"<��9�f1\B�J:���_V�1������Kg/h{S�m^���/I�_I}%�v�G�?AR�ϭ�2�KF����V��~㙫�m���[[K8A�1�lz�_F~�v�I�I�5fi��GQ��6�7&�Vk�XW.[����(#4���������}k4��,08F�+����n|[�[i��I������4-�lN]��b�
Q��e��ަz�mhn����B��V��|M��=���o
���`8�q־B���K;ɞM:P����ߓT�PI< ;՛�*�Kd[�im���$\dU�
�o�`��p���a���U�D!@8a�>�פֿl6Z�}|k��7;��v���\i�v��Ok,PJ>IH���˯�W�� �D�S��E1c��I�0�e���Wr���~���=��ƣp�Z����1�j
����w� q�oC�/¬n.��s4�y�ʹ�s<3��J��0EG]���T���G�x�W	L����&���ڿ�
k��S_�&q=�U�M:�P.-��(2�Z��*�}C�'h~[˔U���;���7c�rL�Y�+�)r���c��R��#�4Wy���������M��_���z�θ:{�V/<"xz��ؒ��[�V(cidn �5�� ��� @����i��<�׭�8�K��?����w��	�e�K}-��m�Px�I�h���jx��n�(�� 3�� ������ߣY�V����\D�ʽRE���ď����GM�L��v�ă�xO��c'����e��ԕ
>���y�]����Ю�R.�8��9ڵc���e����%z�h[V�����[�CT��՝$'$u��ݎ<�.�i�XiK�Y�������_��� �F���ޫe	�}>�(�Wh��������y#�ķ;�wՑ�?�
�_�n�?�-��B�'���\II�'%��{�GM_�i���ƟS���(��(��2\8�$i�
�$�k��^Ӵ_]x��qp2�d��v=��-�i��
\�&���I�n��ϓK�H��1�� �A#��}�i{�PA}���6�"���W�|\��5��@��DR��ڒgn?.�R��|'���5g껣�� ���U��Y��2MG^��$�����،��z>��U<=��ҿ���#��.���C�-hN�u�� L�{�����+�r��pܪ w�y�d��7$���� �F��c���Y.�����J.��{�#4mtu(��V"�~��!��^�n��byܹD
��>��MEM�;����[/	�:�~e��s*xFq^��ល����"�/�r���w5.��G�X\�4�"9m��<�n~�R�c�(�xz!��+�>}TR�������&�K}�v�[7O�!R����4��Z���F}"�`��Q޼b�<,���TK	[�E��f��U��"���+�me��C�J�B�ƫ��Z�#�\1���y���8�پ_��uEW+{8�z�;U��/d�kŵ��T����T���=
��\���m�2��fS�+rE���|�J�]��$� �Z��$k/�4�u��r3ɣO�U�;�����z˨e��<���y��:z����?:�o���w5�Qi�]	�9c�b���L����>���\��J���]�c�+p�YO�_[j��q��mO�����Wm�w�Qx/ŏ������=���Z���T�מ��fY��n�9
Z[�p�#RqW��ֿ�u� ~�{'��=bR�ΤrG�3T������a���)
n,y��}l}U�,^7��/d�}���ƭkK.�sk�f��Ve{��E��zm͠ѭ�����5��ر�Ni���(`��+Y�O{�XJj��N���4u<v:�(�0��(QG
�Y� (�5�|�����ʺ��Y�Z���)a%���y
�I"5a�������HE���i�
����*n�e��p������g�>��l��*�U��`�Z��ڷ���J��B�e�39E���לS[5��G	^Ta54���� ��d�$i$s�E$ԗ�}Ιp`����RE����+�A�C ��<�u?��j�0�*����c��Z��O0��2Q��� �x U��*�L1��im���|�#"�xiCx�Nd���E{?�'-��U@8# Q}l\�b0�Vt��{���U�����o
�v��Zծ�l>y[��;��9ը��]�B��k�pD�H�5,JՓ�z�0������f�������"(E���N�� �R{
�!��dk�&�!�>y��v)]����I�`�K0�r�ꢯoVxt��.QՑ�X`�mv��e���V��M��TĄ��?�q5H�,U*t+J�)��l�P�F�)w'Td����[먭�R���Grk�����=��MeR}FE�b��QR���yL�7)9(S�����</�C榕tc�s�˸���C�<2�J�ֽ����u�"�E����wb���?t�iv�m����[s������݋�eP�)�q|ӏG��y�
�� 	'�z+o��/��2���?Z������#O�K�!_	�.��K� ��i����_��� �F�����=�IaZ|WBt-�c��M\����57o�����'�Vxz��)-�����籹1\B�J)"�E2�x�_��Q��;RP(H�`W=M^4�VQ�.h�����vE얓\���8�����_��� �F���|d��&�t"Vx�w�u��+o�Z�)]?�-��FwWg��&��a(�q��Q]%�?w��R�5ƟqC��dY��^(�� s�=�N�ɷ�\.�&I W��G��ptj%���Fڶ�� X�I�Z��OYpYt����|�R�65��zJ���2~k�?�?[��XG�иB~c�b�z��U�᱘j��UW�����˷�U�� 6�@:fHʊ�_E�_<;�];\�c��P�G�������?	�մ���1�G>Y=?
/ܼ^G�3YU���^���QEQ�aEPc���lv�Il%�QE�QE 5��#��J:
]E�Z(��(��(��(����O����O�$QE1�u<q?�����<ؘl�?�/��/]?�~�~;k���c�빌�=�&w�>���<n�wV�C۞����P��m�8�2.L�{מ�E�?�l��4����>fS��z��W�����~�����6ݡI�������������S�c�#�sR�>�:\B�����*F-�k5�����Y.�t��%Y���O�O�'Z���� ���w_��7������ �u�w�F��������oQ���]J�s���Bݟm�'���� �_�!��?g�1�'Xe8e��?��޾���� �F���4�#� #E�~F���[O�>	��o��B�I�?+
�����A�CXՊ}��@>�Z��x���+mB�	Ye�<:�]�_�o��������df�v���=�9���7����c�ٿC���\x����\6^e�����|�_D��H5� �s�����K��q-IV���7v�ݚ�� ��K� ���b����� S�}�W�h����W-�b�\����6�n�ƞ�5])M����G�*@�P�A�BU�lmj��]��3�� �/�W�_?��_X���?�+W���3���*g�I�d��/����h��\eN;�F3Iӝ�V��\RM�w���G�v� ��� ������?����g��7��{.A� #L?�����J&�� �U�ס�k������o+�ۂ�H�\!Ӯ�ɵ���h[f��+�}�~ezk��t��j�3w�z�&�-��jXI �죭{wƿ�	E��:{�m,��q�^��gO�+���8��̚�u/������5̈J�xCg/s��O	�9T��N�ѿ�O��[����>����<� ���i�+�J��¾8���;+�'O�"L�F���<W�I��_i�23�v�=�+�£��ђ���kg%���^��3�J�ѿ�y�z���(v?F�UOc���� �̻�C���יW�����?����T���{� #LG��W���"��ڜD�)R}2+�J��}�� ����{c��-�_�t�� �_�� ���<�Hu�f-�'��>�x��-�!|�)$n_ʰ���E��k�olcw�f�%����I�8�(?�Г9�f_Z��C�/��o�*�W�u5F\�ɧ��6:��{Y�J���� H�r?��M4�(�A^����>��I�a3i��Q����q^W]��r�£]��f�#"$9|z⓷S�ʪ�hWu�)�E6���n��?�<�6�H������-���Mx���7� �X���O�S���z��ޗ�I���a�]	6�y�^���E��Zd�� r�s�MJ���Ԏ9����AR�N��H���ϝ+�~ �A����y�zO��(0�6�{1�� ���%���㯂��u�u)�w���0�}k��q�?O𯇮55�>H�����}1U>8K���.���l\y{��W��5[��2�ȝpሤ�>�9�e� X�K�w����{���� t����,���?L�G)�O����U�����O�����{B~�7�i~�t�rR�LЀ:W�5�ƥa�_���i"� h@��'���?Z��U�槢ݽ���ȇ(p~��{o�Tj���zS�yZ�m��+��>k�!�Y���LQ�b���3ֹ�bx%x�J��{��gB�(�s�J[6��~����?�X�����}-sb~"|��N`�ƿ&yܽ�$}�Eգ��e*z.��5�o��O� \�׃G�m^K�d�u��m�垿Z�\��*t���H�����CN�R�֫T�QT�}�5��������Z���  �����!�� y��%���>6�=�|is�I�,HCo}��|4�!��"�R�V�[��,k����X�=Ο�$h�!-�U�x�_�~����C��(��}�����l6S�Φ����[;(��i#�>=x��_��j�H�S�޽	�^kW5�2�G�nl�AD�[wS�Z�T���ML^.�z��m�v�=��g]�~���X�gQ��4�����פF�˕�q�Uf���_Q����E6�5��y��l`6:����#	��p�C�ߚڵm|�ߊ-<��ڠ�����r�5	����`��*��T���:����S�q{+��
j��N��i=�,2D�ʳ���u8,ިeQL�(�E�M�Hxi�o"3�Ӝ�^�}k�f��߉��YO�윟-������t��׈�96�d�$1����:�,��Tj	���]��TFM����X���U(�X�-l� ��?�o�7��Y���C��G�������Y|��V`��P|ǝ��]wG`(���

єT�������(ZO���WU�I��m� \p� uX�oiwS�,�1=��z�����^{Mn�&��q�����`�*�=��I^Ji������xc�F-7�������W�A�'�^q���ڮ��{-���2�$�D* =����x$��4��4�!g��ၧ:.u��R�[>��?�5�߳=�Sk��� d� =�k�_��/�-���.�\6�k��@{�d���(T�����~&_�-R}W����;%(���ru��^j˯iP�խ��*D2T�㸯 �K��a
ZNғ��3�k`�0x�>:�kEݶ��Ѣ��k���7�[�jmoo7
I�B;W?L��ѫB\�b��5c��+e��-=e �� �
���uI�<a�1A�^�=��G��<Qa�� R�����k���7��i�2�cz'W_Q�*��`)����a��d�����ފ�.�{�)-'Is��3�ړ�޿����|�Y'V~���>:j�/������su��O�t��O�XU��O�t��O�AX?���_���ď�V~?��K�E�LT�͟�p������7	�/e�}�8�����u�}���wy9���iX�
?�OPC`�$�~��c2�x����秽���Fd���2�6܌��RH��]J��4�G�Y���n.��@ͱd�з�F*�����$�� ��Ĝa*��l� ¸���ve�:�mxu����e�^�q�޵:ݟ��18<>W�����.ڵm���[x
��mD_,ɸ����j��w�|ۤ���(?��Z�~q��*��:4�"�W���k�?�7i��νg��� ������&�O���G�|��^���f��E1D�b6��'Խ��yro!�%����#�}#�ۇ�G���}�P:�n�O���ío�w��oe,Q7�*U�׳�JԬ��7��v���1\���Q�����b-.F��M�s����*��
*Y�'���C$[�Wz����E@�iٍ��ө���u%�+`��)�(�� k��J:
G���t����QE1����(޾����QM޾����(�\u���(޾����?�ҟQ��=����R���)���Q�}E;�㫡�W��j����đ7�q�k�޾����)hmF�L=EV��%�G�q�њ%�$�z���T��dW��-� �"6P��8bS��My����a����G���<�IЩS�{�%V�)�8�Tr���p{�{��Q�}E]ϛN��:O����t6�D�2��L�s��yO�o����-id,b(g'��M��(޾��$���s
��q^Im�:�'��h|��KO������հ#ךo_QF����<�6���ûJ�}��ΖI1��[SILFz��_QBzW���x{��/ë����<��%��k�i���Q�}E؜ul\)«����^����>������<t��)�5���Q�}E1a1��Ul4�d{��JY�j�N�Lw$}�Xc?�xω|M}��NK��L��A�G��va��J`sIY3��cs4���x���~���o�A�_�����tҹM��(޾������OV5�;J.��O�;A��>�3��K)?ʣ�����#��	#�\*��z��7����>��nh��� �c�E�j�5MZ��8V�&���z('�P~�o_QMvsTϐ��۔�g��|_�K�lt[6���������kˉ���M޾����(���c��U8֕�*�:o��/���Q
�D�,����5k�w�-|m�F�--��e�ǖ>�����(޾��7��������[�ut>�J�;�ֺ��g�"w 8$�7���z��49�֞�kSv�]ת:��^2��>'}F(�"���\�3x�9�޾������N�WyIݎ�N�S�r��VwV/u����^_�}E��Svf�,ul���a�i/��п��^?� ��_�|s�u����B),�U^B�/��Kz��7���d{�8�2�NSVj��uO�^?S���%H�tl�[z��ha��C>MI�JKtz�� ���<���Ř�LpI?�\7z��7����׋����u�;���QM޾����)����_�?/�ئ�^��ϖN
}y����Iٝ�Lm|U[>Y#�'��tXcym4'[�8,T��W�x�����53w|�Q�q/�A\�0�֗z��Jǥ��qٕ5J����$�v]/����M��B *�	ҹ���(޾����B���cZ�������)�t��ެ��FߴO�ʑ� ����¾|޾����*l��|[�=��� ���MN=gW�����g,�/E��tSY���
��}O���I��w��x7�Z��/��a6��-ʷ�^�o�Fi7v��������H+���� z��7�����s�c��{*=��&��<M�EIqd��&�,��o�!�@+�&��&ydm����[��Q�}E5dr��LVg%,L�m��z$:��|K��tM�Z�yn� t� �r;��S]��v��CW	QV�.Y.���Қp��]�׎��3�f���_�/^�oG��>��+�}E��P�G��ϱ��?c^���$��m�U� �ؚ՝��3Ȑ>�\Vv��o_QL��7NJqz�N���h~ �Y�oj����p�$���y�i���|�e����7
巯��z��4��e������/{�O������j6��e����s\�G�o��o_QIX�^x���Q��wg�|'����yͣ�C>��]����>ē�JI�J� �|��}E��Qd�	�y�
�p�f�V�I�g�k�4-OH���@a$��S!\{��v��q��♽}E��SVG��f���Q�%�㵒_�,2y3G&��X6C�]� ����2д�>4Z=���;{W��_QM7i=�j8��zU(S~���	(��_QF��W8�:�n��o_QE��u��⮡�h�EՃ��z{������$4z��x����|��}E�:Դ��x>!�04�U=յ�v������>���Ֆ�[�����S�޴���SV�������u�˚Ov��^��_���KF�j6�0��:�Lהo_QF��;3��br��>W�������F1h���O��a��q�^+�j�Z��ח����w31�[��Q�}E
��������Y���l���* #�)����a����o�����f�,���f����=3]���<?2Š�'�����{޾����)YS��\�MR�K���m|��|C�����d2F��Q��=}I���}E��S�+[U��K�O���|�{V�0./,	�	O����o_QMvsI����W�TU����}?h�˶Y���y����� ���ɧYۭ���0��=yv��o_QE���x�2�RtgR��d��hu]�56ѵ{K�P��A&���o_QF��Ϛ��$��>�?���:'��M#��YO��� ���� � %���+���(޾����� ��5{��1� #�����_����,��E���s��j2�x�;z��j��W�<MYV���;����*��o�-*������F��k�� ����� ���� �|��}E��Qdϡ�q.c��=)�X�t��{_�~8h�!��兾�c�eگ!R߁^-M޾����)�#���X�΢��i���K�.���i���v�U�)�^�� '�\"��I�u9u#��y޾���774���_�c2��i$�������$�fh�m)m��	%9��
��k\��������rY�g�_QF��Ց���Ybj].�/��������_ctl��_QF���y*\���/���|wk�Cm�?����:j��n��o_QIYx�e\ug^����m:v�LFz��_QBzI����}E��S��:�n��o_QE��� tҎ���6�iC�i_Q_Q�Sw���z��w���`z
Z(0=��� LAF����@�������>�����AKE1���(���P`z
j�����W�5!��(���S���AKE &��Җ� b��;�RG�iԖ�[	��(���S���AKE 5��x����M(�)uP��`z
Z)�LAF�����S\8��_�&&.���R�Lb`z
0=- ���AKE 0��8�`z
C��:����AKE1���(���P`z
hq�M_�i���`z
Z)�&���R�@	��( c�-!�@@6��`z
D���Ka-���`z
Z)�LAF�����m<P�mP� tү����`z
0=-�&���R�@	��)�S�ړ�L\AF�������`z
Z(0=��� ax�;�R���N�����`z
Z)�LAF�����S@��j��H�.���R�L�0=��� LAA)iJ j��;�R'ݧR[	l&���R�Lb`z
0=- �i�@�8���_�)u'�`z
0=-��Q��)h�����)���I�&.���R�Lb`z
0=- ���AKE 0��qڝ��)����R�Q��)h�10=��� LAMP77�j��!p=���c�Q��)h���`z
Z(�ޔ�AIݧR[	l&���R�Lb`z
0=- �i�?�4����]C�Q��)h�0��( ��( ��(��`�S��`�S�	QLaEPM_���j��.����c
(��
(��ݧSc���Ka-��(�0��(��M(�)�Q�R�.��E�QE ��N��jLOa�QE1�Q@Q@?xS���
u$ ��)�(�� )���:��x��&:�(�0��( �=)iJ D���j}�u%���ESQE ����~��iW�]E�Z(��(�������I�'��(��(��(�����N�����N����(�0��( ���4�j��K���(��(�����=(�ө��iԖ�[QLaEP_�U�����_�)uQh��c
(��
k��S_�'��è��c
(��
(����:���:��QE�QE ���N���j]E�uQLaEPEPc���lv�Il%�QE�QE 5��#��J:
]E�Z(��(��(��(����O����O�$QE1�Q@5~�S���������)�(�� (�� lv�M��ө-��
(��(���4����iGAK���ESQE S_�:���1=�QE�QE QE 4��N���)Ԑ��(�0��( ���4�j��K���(��(�����=(�ө��iԖ�[QLaEP_�U�����_�)uQh��c
(��
k��S_�'��è��c
(��
(����:���:�
(��(���xө���.�c���c
(��
CҖ���O�N��ݧR[	lQE1�Q@�iW�G���~��]E��)�(�� )�ڝM~Ԟ�{��)�(�� (�� i� X>��i� X>��BAESQE SW�5:��y�uQ�QE1�Q@Q@��ө���u%���ESQE ����t��M(�)uQh��c��ѿ�Ө�-F��4o�4�(F��4o�4�(H�|�ҝ������O�J�w�7�uQ�����:�Q���5[�nIM_��P��h��i�P=F��4o�4�(F��4o�4�(HѰ�;��?�N�l%q�����:����ƍ�ƝE����h��ҿ�4����Z���ѿ�Ө�=F��4o�4�(F��4�~�����ba��ѿ�Ө�z���h��i�P���h��i�P��������~�RB�n� cF� cN�����ѿ�Ө�5���C|ǃRSW�LL7�7�uǨ��ƍ�ƝE���Ɛ��������i���	�i�-��7����Q@���ѿ�Ө�5#g�O�6 �ҿ�4��E.���o�4o�4�)�Q�����:�Q���5ߧ���jOa0��h��i�S�w�7�u�w�7�u�e�q��N��h?�ҝI	\n� cF� cN�����ѿ�Ө�5���C|ǃRSW�LL7�7�uǨ��ƍ�ƝE���Ɠ������^����Пv�B�J�w�7�uQ�����:�R7l��҆�W���~裨����ѿ�Ө�z���h��i�P���i��85%5�R{	�� cF� cN�����ѿ�Ө�5��ѿ�Ө�5#-�Jv� cA� X>���7����Q@���ѿ�Ө�5���U�f�Ԕ���HA��ѿ�Ө�=F��4o�4�(F��4o�4�(HѾ^�����ݧR[	\n� cF� cN�����ѿ�Ө�5#g�O�?�J� tҎ��Qj&� cF� cN���
(��(��(����O����O�$QE1�Q@5~�S���������)�(�� (�� lv�M��ө-��
(��(���4����iGAK���ESQE S_�:���1=�QE�QE QE 4��N���)Ԑ��(�0��( ���4�j��K���(��(�����=(�ө��iԖ�[QLaEP_�U�����_�)uQh��c
(��
k��S_�'��è��c
(��
(����:���:�
(��(���xө���.�c���c
(��
CҖ���O�N��ݧR[	lQE1�Q@�iW�G���~��]E��)�(�� )�ڝM~Ԟ�{��)�(�� (�� i� X>��i� X>��BAESQE SW�5:��y�uQ�QE1�Q@Q@��ө���u%���ESQE ����t��M(�)uQh��c
(��
(��
(����>���>��QE�QE ���N���jB�:�(�0��( ��(���u6?�N���(��c
(��� tҎ����.��-QLaEPM~��k����ESQE QE ���:�~�RB
(��(���xө���.�c���c
(��
CҖ���O�N��ݧR[	lQE1�Q@�iW�G���~��]E��)�(�� )�ڝM~Ԟ�{��)�(�� (�� i� X>��i� X>��HH(��c
(��
j��N���4�����)�(�� )JZCҀ>�:��v�Il%�QE�QE 5��_�)�U���Qu�(�0��( ��ju5�R{	�:�(�0��( ��(��`�S���`�S�	QLaEPM_���j���]GQE�QE QE 6?�N���iԖ�[QLaEP_�Q�R?�4����]E��)�(��oAJ��)�oAF[�Qp��)�oAF[�Qp���`�S�3�x�t�e�+�1�Srނ����q�uܷ��-�(�\u5~�Q���-���+�QM�z
2ނ��q�Srނ�����q�Srނ�����p��Ӫ4ݷ��e�$��QM�z
2ނ��㨦�oAE��� tҎ��۶� ����>�n[�Q���E7-�(�z
.M~�e�5�q��؛В�n[�Q���;�����e������e���Q�ۇ���������e�;��QM�z
2ނ���SW�2ނ�n<
Wd�Srނ����q�uܷ��-�(�\u!�I�������qS�Ӫ4-�������E7-�(�z
w�����e����J�tSv���]�
W�W�}ܷ��-�)�wE7-�(�z
.M~�e�5�q��؛$����e�;�㨦�oAE�㨦�oAE����:�%��Jv[�RLI�����e�;�㨦�oAE�㩫��oAM�+��J)�oAF[�S��:�n[�Q��\.:����z
B[�Qp���i��AN�z
I�	�����e�;��QM�z
2ނ�����_�)��i�R�l+�+�>�n[�Q���;�����e����j2ނ�Ÿ�RlM�IE7-�(�z
w�QM�z
2ނ���QM�z
2ނ���� �JuFKo�췠�q&:�n[�Q���;�����e�����j2ނ���7��rJ)�oAF[�S��:�n[�Q��\.:�n[�Q��\.��uF���췠�����)�oAF[�S�\uܷ��-�(�\�Q�Sv����8��_Q�Srނ����p��(��(��(����O����O�$QE1�Q@5~�S���������)�(�� (�� lv�M��ө-��
(��(���4����iGAK���ESQE S_�:���1=�QE�QE QE 4��N���)Ԑ��(�0��( ���4�j��K���(��(�����=(�ө��iԖ�[QLaEP_�U�����_�)uQh��c
(��
k��S_�'��è��c
(��
(����:���:�
(��(���xө���.�c���c
(��
CҖ���O�N��ݧR[	lQE1�Q@�iW�G���~��]E��)�(�� )�ڝM~Ԟ�{��)�(�� (�� i� X>��i� X>��BAESQE SW�5:��y�uQ�QE1�Q@Q@��ө���u%���ESQE ����t��M(�)uQh��c
(��
(��
(����>���>��QE�QE ���N���jB�:�(�0��( ��(���u6?�N���(��c
(��� tҎ����.��-QLaEPM~��k����ESQE QE ���:�~�RB
(��(���xө���.�c���c
(��
CҖ���O�N��ݧR[	lQE1�Q@�iW�G���~��]E��)�(�� )�ڝM~Ԟ�{��)�(�� (�� i� X>��i� X>��HH(��c
(��
j��N���4�����)�(�� )JZCҀ>�:��v�Il%�QE�QE 5��_�)�U���Qu�(�0��( ��ju5�R{	�:�(�0��( ��(��`�S���`�S�	QLaEPM_���j���]GQE�QE QE 6?�N���iԖ�[QLaEP_�Q�R?�4����]E��)�(�� (�� (�� a� X>��a� X>��BAESQE SW�5:��y���(��(��(���i����:��K`��)�(�� k��J:
G���t����QE1�Q@5�S��ړ�uQLaEPEPO��i�I(��c
(��
j��N���4�����)�(�� )JZCҀ>�:��v�Il%�QE�QE 5��_�)�U���Qu�(�0��( ��ju5�R{	�:�(�0��( ��(��`�S���`�S�! ��)�(�� )���:��x��&:�(�0��( �=)iJ D���j}�u%���ESQE ����~��iW�]E�Z(��(�������I�'��(��(��(�����N�����N�$QE1�Q@5~�S�����QuESQE QE ���:�ݧR[	lQE1�Q@�iGAH� tҎ��Qu�(�1�O��O��:�V��?�4m?�4�(�Xn���F���N���ʝ���N��i����Ұ��� xѴ� xӨ�a�n���F���N����?�4�S��j���y�XV��ƍ��ƝE;�v��6��uX,7i��i��:�,#E;~�;i��?�N��$7i��i��QN�a�O��O��:�,#e;O�J�|ԯ�M(�)[P��m?�4m?�4�)�,7i��i��QE��v��k)��)�ړBh6��6��u�;��h��i�Q`�ݧ�ƍ��ƝE�;��N��h?xS�$�� xѴ� xӨ�`�ݧ�ƍ��ƝE��i�N��T���ƕ��m?�4m?�4�)�v�� xѴ� xӨ��a�O��!S��}!�E��N>�;i��>�:�@�ݧ�ƍ��ƝE;��?�4m?�4�(�X���?5*����_�U�����i��i��QNðݧ�ƍ��ƝE��i�������jM	���h��i�S��7i��i��QE��v��6��uX,FT�7jv���A� X>��I	!�O��O��:�v��?�4m?�4�(�Xn���M
w�����4�&�i��i��QNðݧ�ƍ��ƝE��i
��S�J,�q���O��	�iԒ��� xѴ� xӨ�`�ݧ�ƍ��ƝE����U85+��J�tR����m?�4m?�4�)�v�� xѴ� xӨ��a�O��5���T���I�4O��O��:�v��?�4m?�4�(�Xn���F���N���ʝ���N��h?�ҝI!$7i��i��QNðݧ�ƍ��ƝE��i��s|�%5~�R��O��O��:�v��?�4m?�4�(�Xn���F���N����N߽N��h��ө%�$7i��i��QN�a�O��O��:�,#e;O�J�|ԯ�M(�)[P��m?�4m?�4�)�,QE1�Q@Q@?�ҟL?�ҟHH(��c
(��
j��SW�5!uESQE QE ���:�ݧR[	lQE1�Q@�iGAH� tҎ��Qu�(�0��( ��ju5�Rb{��)�(�� (�� i�M?xS�!QLaEPM_�i���ƗQ1�QE1�Q@!�KHzP'ݧSS�ө-��
(��(���4��E#��J�tR�.��E�QE ��N��jOa=�QE�QE QE 4� �Ju4� �Ju$$QE1�Q@5~�SW�]D�QE�QE ��-!�@�v�MO�N���(��c
(��� pү���*��K���ESQE S_�:���=��ESQE QE ���})����})Ԅ��(�0��( ���ju5~�R�.����c
(��
(��ݧSc���Ka-��(�0��(��M(�)�Q�R�.��E���
```

## CyberX-frontend/public/half_logo.jpg

```jpg
���� JFIF  ` `  �� C 


�� C		�� " ��           	
�� �   } !1AQa"q2���#B��R��$3br�	
%&'()*456789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz���������������������������������������������������������������������������        	
�� �  w !1AQaq"2�B����	#3R�br�
$4�%�&'()*56789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz��������������������������������������������������������������������������   ? �ڢ�+��
(��
dw��#���.��>�(�0��( ���4�k��@
:
ZA�R�EPEP_��ө��}iԄQE1�Q@4��N���)11�QE1�Q@Q@_�i���ƝI	QLaEPM^��j���]GQE�QE ��M-#}�@��KH�tR�%�QE(�� k��S_�:���QLaEPLo���c}�����E�QE QE 5~�SW�u$$QE1�Q@6?�N���iuQ�QE1�Q@#}�KH�t� �tR�/��	lQE
(�������N�.�ESQE S�`���`����E�QE QE 5~�SW�u%��QE�QE ���:�ݥ�]GQE�QE ����M�hGAKH:
Z (�� (�� k�Zu5��:���(�0��( ���)����&&:�(�0��( ��( ��( �G�}2?����.�袊c
(��
k��N���4 ����- QE QE 5��:��֝HAESQE SO��i��ESQE QE ��ƝM_�iԐ�QE�QE ��N��J]E�uQLaEPH�t��7�4 /����E-[Q@(��ju5�S��QE�QE ���O�7�ZLL}QLaEPEPW�u5~�RBAESQE Sc���lv�QuESQE R7�4���M �E-"��K@��EP0��(�ڝM~��B�QE1�Q@1��
}1��
LL}QLaEPEPW�u5~�R[	QLaEPM��ө���]E�uQLaEPM�i�����t������(��(��A��S_��ө(��c
(��
i��M?|Rbc���c
(��
)���M��M+�㨦�?�4n?�4\.:���iw�llq�OZW�WԒ�n���F���N��)���M��M����4n?�4�c�����ǎ����|��q���q�Sw�7�.E7q��q���p~��N�ݎ�ޝ�� tҸ\u����������㨦�?�4n?�4\.:�~��q�首;��I�l��n���F���N�q�Sw�7�.E7q��q���p_�i�c������ t�LI����� tѸ� tӸ�:�n���F���E�㩫ҍ����c��J���(��?�4n?�4�E7q��q���qԍ�M&���H�p~Z.�tR���iw�.	����� tѸ� t�p��)���M��M���TlǏ�ӷ�W�E7q��q��q�u�����������S�.���M,w���bl��n���F���N��)���M��M����� tѸ� t�p�/�4�1�~SN��i&$�QM��h��i�wE7q��q���q������M5�����\��n���F���N�q�Sw�7�.H�t�n?�4���4\.9~襦+���?�4\E7q��q���q�Sw�7�.�N�ُ-;q��q_Q�Sw�7�w�QM��h��h�\u1��
]����X�-&��-����������q�Sw�7�.E7q��q���p_�i�c������ t�LI����� tѸ� tӸ�:�n���F���E�㩱��7�j1��i_P�%����������㨦�?�4n?�4\.:�� tѸ� t�3���qà��8)���h�\u�����������QM��h��h�\��Ӫ7c����n?�4�E7q��q��p��)���M��M����(��i����M�d�Sw�7�w����� t�E�㨢�c
(��
dw��#���.��>�(�0��( ���4�k��@
:
ZA�R�EPEP_��ө��}iԄQE1�Q@4��N���)11�QE1�Q@Q@_�i���ƝI	QLaEPM^��j���]GQE�QE ��M-#}�@��KH�tR�%�QE(�� k��S_�:���QLaEPLo���c}�����E�QE QE 5~�SW�u$$QE1�Q@6?�N���iuQ�QE1�Q@#}�KH�t� �tR�/��	lQE
(�������N�.�ESQE S�`���`����E�QE QE 5~�SW�u%��QE�QE ���:�ݥ�]GQE�QE ����M�hGAKH:
Z (�� (�� k�Zu5��:���(�0��( ���)����&&:�(�0��( ��( ��( �G�}2?����.�袊c
(��
k��N���4 ����- QE QE 5��:��֝HAESQE SO��i��ESQE QE ��ƝM_�iԐ�QE�QE ��N��J]E�uQLaEPH�t��7�4 /����E-[Q@(��ju5�S��QE�QE ���O�7�ZLL}QLaEPEPW�u5~�RBAESQE Sc���lv�QuESQE R7�4���M �E-"��K@��EP0��(�ڝM~��B�QE1�Q@1��
}1��
LL}QLaEPEPW�u5~�R[	QLaEPM��ө���]E�uQLaEPM�i�����t������(��(��A��S_��ө(��c
(��
i��M?|Rbc���c
(��
(��
(��
dw��#���.��>�(�0��( ���4�k��@
:
ZA�R�EPEP_��ө��}iԄQE1�Q@4��N���)11�QE1�Q@Q@_�i���ƝI	QLaEPM^��j���]GQE�QE ��M-#}�@��KH�tR�%�QE(�� k��S_�:���QLaEPLo���c}�����E�QE QE 5~�SW�u$$QE1�Q@6?�N���iuQ�QE1�Q@#}�KH�t� �tR�/��	lQE
(�������N�.�ESQE S�`���`����E�QE QE 5~�SW�u%��QE�QE ���:�ݥ�]GQE�QE ����M�hGAKH:
Z (�� (�� k�Zu5��:���(�0��( ���)����&&:�(�0��(�oQF�S��aXn�Q���(�Xn�SSv:��%2?��Ҷ����EoQN���a�oQF�S���a�oQH۶�E>�� t�`��v"��)GAKE��pޢ�7��QE��pޢ�7��QE��o��Zv�P�֝J�a�oQF�S��`��7���)�Q`��7�����J��~���4oQF�S��`��7���)�Q`��7���)�Q`�ݸ�)�oQB��N����7���)�S��7�(�z�uX,7�)��EIM^���X0ޢ�7��QN�a�oQF�S���a�oQH۰y�F������E.�R���X��a�E:�,��a�E:�,#m�r)�oQC��R��7�(�z�u�;�z�0ޢ�E�z�iݼr*Jc}���4.�Q���)�,7�(�z�uX,7�(�z�uX,F7n=)�oQB��N�����a�E:�v��EoQN����E57c��)���V�,oQF�S��`��7���)�Q`��7��m�<�}#}�E��Wv"��)W�Z,	�z�0ޢ�E�z�0ޢ�E��9�7���S�XV��a�E:�v��EoQN����E0��9-1��
M	�pޢ�7��QNð�7���)�Q`��7���)�Q`�ݸ�)�oQB��N�����a�E:�v��EoQN����E57m�*Jlv���Q���)�,7�(�z�uX,7�)v�ȧ�_�,��R�E(�)h�Xn�Q���(�Xn�Q���(�X��`r:Ӱޢ��>��V�z�0ޢ�E;��EoQN����E4��9%4��I�4oQF�S��a�n�QN����(�0��( �G�}2?����.�袊c
(��
k��N���4 ����- QE QE 5��:��֝HAESQE SO��i��ESQE QE ��ƝM_�iԐ�QE�QE ��N��J]E�uQLaEPH�t��7�4 /����E-[Q@(��ju5�S��QE�QE ���O�7�ZLL}QLaEPEPW�u5~�RBAESQE Sc���lv�QuESQE R7�4���M �E-"��K@��EP0��(�ڝM~��B�QE1�Q@1��
}1��
LL}QLaEPEPW�u5~�R[	QLaEPM��ө���]E�uQLaEPM�i�����t������(��(��A��S_��ө(��c
(��
i��M?|Rbc���c
(��
(��
(��
dw��#���.��>�(�0��( ���4�k��@
:
ZA�R�EPEP_��ө��}iԄQE1�Q@4��N���)11�QE1�Q@Q@_�i���ƝI	QLaEPM^��j���]GQE�QE ��M-#}�@��KH�tR�%�QE(�� k��S_�:���QLaEPLo���c}�����E�QE QE 5~�SW�u$$QE1�Q@6?�N���iuQ�QE1�Q@#}�KH�t� �tR�/��	lQE
(�������N�.�ESQE S�`���`����E�QE QE 5~�SW�u%��QE�QE ���:�ݥ�]GQE�QE ����M�hGAKH:
Z (�� (�� k�Zu5��:���(�0��( ���)����&&:�(�0��( ����ѳ�������4l�4�����Ɨg����u=iu�$����ѳ�������4l�4����M=�#.�hG����ɥ��hGQM��h��hGQM��h��hA��:�u����搵E7g��g��=GQM��h��hGSO�l�4ҿ8��bԒ�n�sF�sLz�����ѳ�������ѳ�����N���ǓN��i!!�Sv{�6{�c�uݞ捞��u5zQ���U8�K��$����ѳ�������4l�4���M�摓�<�Q��E-1W�ɥ��h:�n�sF�s@j:�n�sF�s@jڝQ���Ӷ{�BE7g��g��=GQM��h��hGS�.�sM+���$����ѳ��=GQM��h��hGQM��h��hA~�Ta~cɧl�4���)�=�=�1�:�n�sF�s@j:�ݣg����u��Z�QM��h��i�Q�Sv{�6{�Qԍ�M&�sH��M������������4E7g��g��5E7g��g��5�N��zri�=�!����ѳ�������4l�4�����R��4ҿ8��bw$����ѳ�������4l�4�����4l�4��xӪ0�1�Ӷ{�HHuݞ捞��E7g��g��5M��ѳ��Qr:�]E�%ݞ捞��E7g��g��5M�h��ip��@j8t���M.�s@j:�n�sF�s@j:�n�sF�s@j�}i�� ���l�4���)�=�=�1�:�n�sF�s@j:�~��g�����&�'rJ)�=�=��uݞ�Q�QE1�Q@2?������ƗQuESQE S_�u5��- �)h ��( ��(��}i���>��B
(��(��~��SO����(��(��(���4�j��N����(�0��( ��Ju5zR�.����c
(��
F������~襤_�)h�(��QE 5�S��ڝH]B�(�0��( �7�Z}1���bc袊c
(��
(���xө���:�
(��(��ݧSc������(��(���饤o�h _�)i�Z�
(���Q@~��k��RP��)�(�� )���S���Rbc袊c
(��
(���xө���:��H(��c
(��
lv�M����.����c
(��
k��N���4 ����- QE QE 5��:��֝HAESQE SO��i��ESQE QE QE S#���>���iuQ�QE1�Q@5��S_� Q�R����
(��
(���֝M~��N� ��)�(�� )��u4��I����)�(�� (�� j��N���4�HH(��c
(��
j��SW�.��:�(�0��( �o�ii� �ZE����-��(�aEP_�:���ԅ�(��c
(�:}֧p�Z[�s3,q!bO�T�J*�vCI�^��}k�<�#|B�Y4�ѭ_�7Pm����ҽ��&�l#�����Z+4�}2s��ώ�{*n5q*R]!�?�E�g��ɱ؝cN˻��>#�6�e����i��2s_����x`!�Ð]J����I��z&���/H�Ec�Z�F:,0���W����Pv��e?95˘��p�g�Z�z+� ��Wa��:���:��=�s�+����~#�.����h�O�_�J��uB�:�b��y������r�z1�j���~d���5�p�����?ƫM�4�I��xZ�� ���k����^0�	�B��M� �>�����?*�>�@���xKT�������Լ/�hϲ�L��oI�e�b�^��k�6��&����n�"�K�&*/�������>�o��k���d8#��_��� x�7�|-���Z�L�y?�?a_�����o4iOE�%�~�־���I�j8�s���I~��[�qp֛R�??�>�����7�]d�H���!^B#yr�<~��~&�F��ۓ���i����T��k���r����#7�=~�g�=��bp�ƃ_��bSc���lv�����uQLaEPH�t��7�4 /����E-[Q@(��ju5�S��QE�QE �� X)��� X)11�QE1�Q@Q@_�i���ƝIl$QE1�Q@6?�N���iuQ�QE1�Q@5��S_� Q�R����
(��
(���֝M~��N� ��)�(�� )��u4��I����)�(�� (�����4f����i٦��B�>�Lњc�Lњ Zk��K�G?)�!GAKH���Rf���I�3@�֝Ls��ӳHB�I�3Lb�I�3@M?|R�O�)11�Rf���Rf���I�3@�xө�~cN�$$-��4�-��4 ���K�E#����)3Fi�Z)3Fhi�3H��4�*��KMS�\�-��4Z)3Fh�:��^�t��z�->�[˹X*C
�f?AQ)�	�N�M�"�t��u�/�7�i��S��N"���[���~��:[�9�Ƨ4���A_\xw��O��ج4�,-#X�@���~Ğ*`2�,>UmQ}���{�姙�8����/�=�� �>P�o�ƫߌ�B��66<�s��_Lx3�g�|l�hz-��P���V<����~=�� �,��\խ���� �� �����s>%�x����VS�Ў�� [��Ϲ���<�<ЊV���ٿE|���ۿA�̖��%զ�������+�����|Z싫&ݿ啂�����_K�xe��S�F/�޿�
���y��!�a��~_�~�j:杤D�^�[�ƽZi������_<8X\���VVԙ��;����|I��uJ��S�癜�����_�`��F��������?W��?�SK�����_�������Ե���(� ǈ�~����� ��r���4�W�k��њ��>p�5iS��f� K\��-����M��V!�_
�W���P~��+c�����*���4f���\0վ����/�3\A�?���4����w-��J�-O��#/�s]���[|3֊�����oẅ��1_�J~cN�y�	�~��Ӝ����t��lt~+?����|9�T��v����uo�[�� ��{��x����E�	���4lA�z��h��e^#��� �7m�)�6q�W�fW�r��j^SV�U� #١�PzW�oG�g�-s�9�V�������s�<eC:��c���?o����|S�����t��� ��kO�?�դ��r����m��.#1���b��@�k�i��Lt!N�RMZi�-w�����{2���[�Z�X��\�]/Z��F޶�A�B�ҨG�jY�{���F�#�fcԓ��(~Z�݂q�T�ݏțM�>�Lњ���4f����4�~SHB����?(��0B�I�3@Ţ�4f��S��zS�H]E��4f�Ţ�4f����;4�?8����I�3Lb�I�3@E&h� "��N�)��;4���Rf���Rf���c������iu�)3Fi�Z)3Fhi��M.i����- <
3Lb�I�3@E&h� #�Zu1��N�!E&h�1�E&h� -4��K�i?8����I�3Lb�I�(6/��b�
u���v/��b�
uY��_AM�F:w�)���Ƌ!ub�
6/��QE��7b�
6/��QE�Xn����i�M�h�� �⍋�)GAKE�Xn��l_AN��!�n��l_AN�� ����;b�P�֝E��7b�
6/��QE��7b�
6/��QE�Xn��ңx⤦��(i	�ؾ����)�Qd;ؾ����)�Qd�}�S���,Fn<S�/��~�RI��_AF���)�a��Q�}:�,��v/�"��J}5zR����l_AF���)��v/��b�
uY��_AH�6�)��MB��A��.����E-@�݋�(ؾ��EC�݋�(ؾ��_D~�� ����Ia�<D�X�}N䈍�\�=޼l�7�d�Yb�����Vu�p�q�U*1���N�����/�W��~ǥF�M�L0���k﯄��/��OD�mV�Q+�u	�2���»F��5���i������c�%���^�i�<�H73��Ԛ�;�5̸���M�t:Au� �����ղ܎�^�߽>����[��7��Nk�{S��@��[2?��S_<�n���4��<��eQ~b�� �?������I�[������}5�܇-$�O�={�1�v74Q��mѤ�}���+�_#��x���x~]�/�>����qkњ�����6�+�ـi�z��Z��\���[׻�o���s�%ą��Y�{Gе^�i���}r�X�ʿ�r��xz�.�`��{�Y=C��N7���ɿ.�$g�_AM(7�����؛�>"\x��-հLg���������~x7˕���{�� ����g�ޟ�|�o�.E��
su��CU� �m�\�0�=�Ĥ�y��n~{�	�<I(�K��/��@��+Ӵ��F���E[����T#��~�X��zd	��6� ¤Hʭy��>;��ƣk����'�r����� m�i�g�G��)�[Q״�l�XU���
����Zr �W����v��
���h�k�k����ޘ�H��M��8w/�����g�+� xx/>"�-�"Z�q� ��'�1����� Z��ͣͮ(������� "j��� ˥�� ��� ����x����ܠ�	���7�-3Z�e�(� �i�?�b�B|�<��p�&q&��q���� ��8k?�.>���~Sx����'����E� ��S�W&����F�`���&]���цk�����6���V� �Ч�&}r���_�x��Q�p�����-~{Щ�k�_�~Zl_AF���?��N&\�GV(z�;�G�8���g���;�hu�"{U`��o�+�<���|�%������/����x����44�_y�l_AMDzT����}e��&چ������>+�a�t�o�e8Ha\�Y�����i�7�o�Q�H�F����FI�|���!ʫf�3���]���������baA�\�~��1�>�y�m�a�dt�A�yKG��+�8 ���fWR�) �5����%���n|C��R�T �6��	?�_F��_�pǊ_���cO�����W��ݽ~���f<2���a��O���_AH�6�*���ƙw-��/oqx�e#�]���4�%u���[F5P`qK�}*��KN�Iؾ����)�Qd;ؾ����)�Qd#uqNؾ�?juB��v/��b�
uY�v/��b�
uY��_AM*7�*Jc�4�л�Q�}:�,�a��Q�}:�,��v/��b�
uY�Ǌv��/�4�I"P݋�(ؾ��E;"�7b�
6/��QE�Xn���A��IM���d+��l_AN��!�n��l_AN�� �݋�)F��>�� t�d+ A���R���� �݋�(ؾ��EC�݋�(ؾ��EAb7Q��zv��?A��R���_AF���)��v/��b�
uY��_AM*7�*Ji�←���(ؾ��EC�݋�(�QE�X(��`QE ����O�G�]E�}QLaEPM�i�����t������(��(��A��S_��ө(��c
(��
i��M?|Rbc���c
(��
(���xө���:�
(��(���)���K�����)�(�� )�ZF�������~襠K`��+��g����<M�G� [Y?s�Ï_�Ex��k�ɰ��b���[藛;�X:���Ej� ����?e���x��v�4�C�X�0f�f���_jAv��0��(UD
`*�A �#�BF�*�� =+����'H�i���m^�F��~y[�����4�x��4�nЂ�y/>�����ev��j����/��m}WY�KKHFK1叠�|�����~)]K���&���8XQ��{�����a�ϭ�\��������!�#����_�� ��ef=)��P��������<ktp��?�� ��
}���S�(��#TQ����^��6���e���vy>i(�����������a*�Ty�"ݻ�^����{zХ{s4���>�����j>.��vM�Qs3�s�5����xo����hz]��@����y5���O�<a�xCN��X����K��g�;��q�9���6�ސ���-߭��pyN,�4�y=����� z���8��̐�KH�@��俉��Pl�c�0���c�U� ����Y�˒�εss��c��}&Q�i�J�-�0}�������cx��n4W;���� #��Ӿ�k4Sk)}r����y�>�
��ޖ��Mò��%�A��ܒNO&��k�E�I�R��ݗ�~l�Gc�������������I��>ŧ'a[��I�V�����z�̃�8��yU��8_$ëS��� �S��x����Z_{=�h�����/3�G�U�o�g�M���	�Do�+�6�g������RVxZo�܏��v)j���g��?�Gč:L�m~k��ˊ���U��������R�~5���N���?�O�a"�¹���s��Y�����O	�ٞ�	H�e��gn1r�\� �3�ֽ�B�v��ku�J��o�n����~L֎��MS�wiu���XΧ!����+�3/
2���VT�i{����8n+�,D�����֭��WRӭ5�G�������9�2��5�� ß�O�ZEm�XZ�t�L���+ꏇ�<+�.�[Hԓ�8��&;%_���+�߃s|�^ҵ;�}���|�}�6�f+������~G�|Y��4	��%(�o�[�o�.}u���c�� ^�}�=����e2���|�=U�_�~m`x��:'��4�n�;�w2U=�}w���e�43֥��K���y��\3C�L?�?�� ��������čg�����i��G�,M�%OL���/��]OG�5]$�Q� ��޼(�����2�!�9Rj�)�4� &�3��|N[_��q����?K��{��/ijm�[=^5}���꾢�7�~J�{�:���k}OK�����Fp~��W�� ���e�R�t�E���P��p���/����<<����*V��>�{��d��1���4����H�h�پ��m��ƏZx�%,
�-������.���h��7�=��RH�*E~������9�>��K�^� X�Al��c�*;��^��L�Q�3^��2g�� w��2�����a���]� ��g���E->{il�x&���2Uц
��eN&��?*��aES ��(�ڝM~��B�QE1�Q@1��
}1��
LL}QLaEPEPW�u5~�R[	QLaEPM��ө���]E�uQLaEPM�i�����t������(��(��A��S_��ө(��c
(��
i��M?|Rbc���c
(��
(��
(��
dw��#���.��>�(�0��( ���4�k��@
:
ZA�R�EPEP_��ө��}iԄQE1�Q@4��N���)11�QE1�Q@Q@_�i���ƝI	QLaEPM^��j���]GQE�QE ��M-#}�@��KH�tR�%�W����3X�K�i��F/,������5��Z'�u?]}�K������HP��+�8� \E�Xn~YE�'�����=�3���{gd՚?N�m�/�^�յ[��T����{*����w�ϊ��ŏK�^��h����?,Iۏ_SX^$�����Π#��4���+�~��<?z�Z�g��%�z�g~u�O4�:k���տ1�ڝ[/�u� !}+G��O-%�g���ZU��^[�mp��U��k�֧)�q�r[���,��1�qv}z�[[�lnb��F�h�::�#��I�2S����7���Ο�Gd�es2.�u,d��<�5��/���A�5�Jk�I�]�U��V:(�y8Ѥv8
�$��p�.[�ԕl-�Ov���>G}|����Z��].6�+yngH��s�QI&���w���ou�tM5�@�|��{~5�o�>xO��4�69.���� y�OO¾_9�l�,n���]#����\����㒜�$;��K��|[�� ٻ�^1	$:KX�6�z|��\M{g�a�H�$���7�Cd�G��¾�߷ p)|�z���y�2ꌕ(� uk���>� �x
�No�o�S�~��������q�W1�DW[g���6(/�7۫:�nu;k0L�1B'�p���?�O�Z^~��->;4��5�R����Z����G��Y~|��"��8���i~[�?�|e�U|"�~x���F��ӵc�|�F���E���+h�F�-�썸�B�C��>3A�c�Vɦ�.�`�"g21���_�p>:��)�ST����g�����<KS-x&���ukZ�{t����:��xӫ�%���O�	a ��=)��d�ZO�uG[�!K�t�XⷐeK���w⾰�ßx�N6:��g4`R�B9��s��l��N��-��v���u���xb�c��ʚ��]�{��=��s�]Gsi<���w,�1V�+�����@���B��[�'���������jYjvr�]Fp�ʤ���:��w��>�{�U�#��e���v�vko��C�� �{��4��^Z�*���'�ÿ־��� �4��jU�W�����6E~T�w��&��TY�&3X�~��C�8��>�������R�M�~�� '�M�q=\4�g��W��g�T�'���VH�a��A��J��?e���'�`�Fd�Ӑt�dҽ���m↊��\�L Z���M�G����x<�_�e��ǆ1�Tӌ�����5�?��#��g8e}S�K����n��:�e8 �A�ZF�y��V��kw��X�
�_V��߳�]�q�[�r��Q���=}E|��Q�� ��j���3|.}��Ժ�(�����?�r��V#�U�O����?Ag��6� 41g|��-T	������kؼ����u�֚��;Awnᔃ����_�?�)�|S����P��<��� J���Ee5�����f��W������8s:Y�>�]��?�2� >���_U��z�so�� M �u�E~�\G�A2,�H�Yd0=A���h߃�|2�k�Y�N�~�Kw�{��W��ʽ5�b��E{��_��yz=�9/�^����.Ͽ��<��(����B�(��ju5�S��QE�QE �� X)��� X)11�QE1�Q@Q@_�i���ƝIl$QE1�Q@6?�N���iuQ�QE1�Q@5��S_� Q�R����
(��
(���֝M~��N� ��)�(�� )��u4��I����)�(�� n�F�K�1KQj&�F�K�1F����5���M���4�������.(�=G����.(���o��i�b���h�58���)@�Q�5D�(�)qF(�5x�x���P�c���ӷ�G�>��R�Z��Q�R�S�z��Q�R�Q�j&�M.7�~)�|⓸�x�x�����x�x���P�M��b�CQ���N�) ��;�Į&�F�K�1OQ�&�F�K�1F����"��;�)kqj��.(�=G����.(���o��i�b���h�5\`R����j^+�#�Ҭ佺~����
��S�O�>�������������:W$�xzU���6��GU<&"�7V��ݤ�g�Q�R�W^�.�o�?>^|U�Dv���N�����
�����hW~$�-4���W2�@�k�#�Gû/�>��-�Z���3c�$=
��(�?�0ܔ_�g���� ����%��9�/�C?/��:���t�m7M�KkX"�g����O�'�Zl����QŨ�αy� 2+v>��_@Ow�/,�#��3 S_����mpiz{� Ē���?��-����8K��f���n�w��}{��q=l.-��y+E~�#ŷ�7�\Ws��>��K][[T0��A��a��S_��E<-)V�.X���nWV4h��쌟�Y���G����3���F1�ǵ}����x�>�Essj��2�2�U��Z�|�=�އ��۬j������ޤ�He��<W�� �F'5n��R�e�������/G.���������b@�jz՞�h�W�QZ[��I+��s���-��?�l4򺮰<���q�������y�G�_�>�$����C�4�\�7��4����7�����6�l&\�*^�N�e�� D}a���im�h���W���ş�¼�ߵg��LΖ���[7;E�ǻkǱF+����r��&�)˼��6���G�c[N�,{GO����<W�kn^� S��c�f�����i�ub~�j�J�Ԥ	ii5Þ �2�ʺ���5Ԑ<>��z3Ǵξ�U��EiJ0_$xp��Ļ�.Oѳ��(�+ғ�u��XhR�]A���qb�������M�ʰ�g���k�� _�o,�wF_�8 �q�o��x[W�܋�2����DEf�������G�(N�V~g�~�?S�6�s�o.�{�;gލ�F�}��/���-�F��d��~��W�V*�����~�;�:�[;��VHX���ϸ?��x�K����ۺ�Q�97���T�=?��C�#ͮC���K��W�V��ܠđ�c�+�� �������0
��c������sO�m�[8���K�yF�6�"��e9�A�R��%�������<f;��-%�/u�S�ϋ� ����o6ƿљ�wy��f�yb8_�څ���g-��)qo*�x�|k���w��6���O��fH@�[��ֿ\��,��eS��K�����s��	<VZ}WU�k�<���>�>��j�M�E*�3�ȽՅ}���ޙ�Sñ�Z8��0�ԟ�6� z���u� j�Io�����49�eN�k��^�����IV�Ͽ��;6C�Tʪ�Tw��]�����-g�x �ǟ��������D�-����n���� ������߈>��t�,�<ȳ�F�Ԋ�� h�����^��}�$��z{b����ܧ5�:I�9(�=�������u��fl�ͮT��/��~��[�z�O��<a�vm:b"��td�_��\)|����XZx���W����
�p�cZ������+X��t�{�IVkk�F�r"�����������W�e�o!���W��ȿ�����Bl�@�d�z�t�+��6����n#!�\"�(;��]���E� �5u%i.Ϫ?05�*�@ծ����+�in�1�R�+����ᨷ���u�?����[����&+�K(�c�ࡊ��u��_�C�\�/��b熟M�uщ�Q�R�W����1�qN�)t�b����oo����oo��j��SK⟊i�⓸���(�)qF)�=D�(�)qF(�5x�x���P�`q�ӷ�@>cN�%q+��Q�R�S�z��Q�R�Q�j&�MGi����ikqj.�F�K�1OQ�&�F�K�1F����#8�iؤq�5D0)w�P8b�CQ7�7�\Q�5D�(�)qF(�5�0>�����N�-E����.(�=G����.(���o��x��G�(w��o��j=D�(��j�ESQE S#���>���iuQ�QE1�Q@5��S_� Q�R����
(��
(���֝M~��N� ��)�(�� )��u4��I����)�(�� (�� j��N���4�HH(��c
(��
j��SW�.��:�(�0��( �o�ik��}�y<e�/I@H�eq��ʲ�R4�ʤ�J洩J�H҂����g�?�������!o�?�1�C�ǭ{E�_Y�or�$�WW�V���N����
�G@ ��'�o�ǁ~�h�n�S��;ی���q�������)�O.�r?�h��d�r��q�Ͽ�φ|Ykoc�Z����+�R<t1��dv��ܖf9$�5��:�|�:�~��B٤V��X�U��=j�H�_�?��NX������՟D������-���Ӄ�a�S�~=+�O2���}L���A��b4Q�X|{o������vCyyA_�����{�k�;Ev]�'��P�2�	;(+���g���_�N�� �KJ�l�.odCʯd�{��Uk\��u�V�P���sq!���&��i���v����DE$���(�ieEF;�'���C��6̪���V{m�t_�S��m��P���Ht�%+wO9,Iܚ����<�[�Zd"8�Q���H�ؚ���6��i�H-B+j3%������=�ƌ��UFI'�+�>#����T����}��~��\?���Y~�K_%����/"��I��b�fv8 z��� � i��Z[���5��%%�S���/���_�GǇ�$�xsB�����<�;j�����8Z��c�yn��y�?.��q7�r�+Ei).�K�Ϩ�$i]�ػ��f9$�{KH�I�jxú��uHt�2�8
�������?ٿJ�|p�:�&���pF�#�s�_i�gl���;���� $|vQ�b󚖢�����ߑ�����W����6���E�ˑ�:�������<<�˩�������ly�Q^Č��UTp �
I.�/#� ��p~G�q&e�n0�${G�s�l����
R�}���o�b'��V��O����b�� J�`W����ǃ�(�έ�+o��qҼ�T���XK-��upGF���^E,�2���'~����W�2���Z*���>��(�+�_�m���-G���N�hi� �e���,i�����	�W�_�� 3�<S�I��~� #�+�Kkؚ;�#�6�  ן�����]t������yd~�����5�|�=����M���W���Ŧ��gu�L2'+���U>oz��������\j/�� ���~!��Z߇�K�_�AɋeQ��^yeq��=��/�p�ȸ �+��ͮ�'��F�q{j�_c伄 �}������Sj�=s/�[��S�3^�Q:�{����>�3�*�߄_���7�	v�ѝ��h�;G������Y�g���c����1�8��5�W�S��Ͱ֕�N_�ɟ�FX̣��R?��~�&���t�h��zU����̇ЎƵ�����K{��hdR��2����➥��]K�gild \ړ���C_u�[�v>/���M:a5��yS�q_�g�=S(��i��o'������yK;��5j�u��y~G�ߴ�<����Dϡܶp|�?�}�+ū��]�m<G��i��,ַQՆz���~)|>��s�˝2`Zܒ���t=+�~Υ���\C��v}�����W��.���:�ܞ��_�>�O�<e�xJf�HԮ,Y�����:o��]�x��O����>���dQ_k�){Okȹ��_�>���~˝����pR7�4���Mn`h�k^��Ʒc�Y9���A"�z��k�S��.�񯅴�bٲ�1#���~u���tW�_��Lr_x^�O����� }����/��3�P^�?�%��o���pfe�lg�&�ڛ�m���Gx�ö�1𾣣܀c���'�[��+�_Ѯ<=�^�HR{iZ&���O�_ �־���u��{`�cĄ<�������<>"X9?vz�U�k�>����k��6Xh��?��Z(��d?�����N�.�ESQE S�`���`����E�QE QE 5~�SW�u%��QE�QE ���:�ݥ�]GQE�QE ����M�hGAKH:
Z (�� (�� k�Zu5��:���(�0��( ���)����&&:�(�0��( ��( ��( �G�}2?����.�袊c
(��
k��N���4 ����- QE QE 5��:��֝HAESQE SO��i��ESQE QE ��ƝM_�iԐ�QE�QE ��N��J]E�uQLaEP_D~Ȟ�ڦ�*d[��G�7R?�_;���  �><7��LR�&��N;�O��I]���q�n�-������h�IiM9|�_�����2�K��|du_ZhPɘ,|�����ԗ��ag=̄�B�O��ϯk�x����#73����?LW�p�K,D�����.}��~���/Z�_E� �=}M�%�)l���\G��� $tAԏ����m$���� ZI�"��N+���$~𶙥ġE�
���'��}'b]<*��y�}��\�b���MiMi���.t~e|��Q�A>"�Rhv���~���Jz�B���ǉ��5=RC���̣ձ�������]J�{�ؼ�9���$�׃��r�ib��� %��OǙ��B=g��[}��+?j�O�V�j��'���!1٫�޼�Z�(���l����S��<�ʿ@<9���kC��-T$ш��:����*8�Sz�O�'�pFP���c*�r��r��o�~ex?�-�x�{M>��ۨ]/�D�y�3��kԼm���f�V�#l����ξ��u�]f�R���qq!v$��j�~�#�����݇�� �i�y����AڥM��� o��'''�Z���j�L�a3\L��p��>����"�K;�UQܚ�K�g��~�}.nc�]�i��PvA_�f��r��Y=����p�GS;�{=��Y?.�͛� 
�i��d�Y� 7D|�}���̪�n+���Ѥ�@�����kϗ����%,+7ľ�{��������	9.XGD���^}��w��>h���a����&�?�=���f�7�.�߽������U ���k�����g�iY\��I5~���XL�)(�O��;�gM�ͤ���O�W���@Ic�r}M��S�o�|f����JГ��A��kմ_�'Q�U�=b|�X��z��	�v�Q'�w�,�2�6�k���v>~�����Hѕ0���7�@+/U��Wi:~�KvY����pG?����o�=��fu�{$�$����~�� x�\�}�Ϥ�3ڰ9(��o��]_��g�xX<�c���d�;�N��SC%���Ѻ�U��V�L>6�Qjq3�jᱹ]U�c*r[n��}U�������+��]6n��[qڽ���+�RXdYbq�t9W�z����W����Q��IX�������Ӓu�J�����Ҳ3�e6f}W�u�}��-O�V�>��ۥͬ�Xr=ǡ��>1�$��g����'$��c��'޾�ӵ[}Z��IV{y�2:�gx��6>3�n�����2��va����3
�Uk?��_S����ṡeQ/v]�����Z�������^]6�Rt{�
��"sч���>��7��;�l��t�Esќ����q(�8wNZ�K���XlF''ƪ��g���?K�u�Ճ+�;��/��c����T�S,,�Z���~#���)��y.�GN	'���O��]2d`�+�B�S����� �4J���e���Q}���?7]7d`U�����W��О_��im��c~<��8���טW��j��Q�hm%s����������.��~fׄ|�x�WM;I�3�0�=�=�мK�1����<�����5��ۓ���w_�Y�m{��~�翗���}\A����=��1���cm���d#�̲��k��N�����3�p�BU�V{WA���� �z�lTA2��C�~���{��S�-�C�����  ���:���*x�2��ٯ��W�W+�J�v�9~)���{+侴��6�r�u>��ם~о� ��ᦡ�7\Yb�<x�?/�U� g��5����=�m�=~^��D��;�I����6���IQ�[������M��β�*������+_��;������k[�:c�<VE~�	)�Il��z��Jr�-ӷ�5�S��ڝTe�(��c
(��
c��c����(��(��(���4�j��N��
(��(��ݧSc������(��(��� tө��M (�)iAK@Q@Q@~��N��A��RQE�QE ���:�~����QE�QE Sw�Ѹ� v��q�Sw�Ѹ� v���S#���.���j��辢���Sw�Ѹ� v��㨦�?ݣq������4n?ݤf;O\.8t��c����?ݢ�q�Sw�Ѹ� v���QM��F���.�>����qޝ�� v���QM��F���.E7q����h�\u4��F���ic�qCbl��n���7��q�u����n?ݢ�q�Sw�Ѹ� v���~�Ta���;q��$Ę�)���h��N��)���h��E�㩫ҍ����c����\��n���7�Ӹ\u����n?ݢ�r��`ڦ�eh�sM2&>��A4�t���kX���5�b�(��� j�Mѣe��!�� �Fk�2�����N�e����ì-���-|RK�W�N+㗈�>j�+m�t�:c�X�#��?j�hšir�f����(��5�.�����

���������sob��R��Tz/�_� o�J�.�I�|��z~�����_4~��^g��&LT�I��� *�;̯��[������~���%C(U��F��h�#�j��O��4o���̐z�� �����/�?_m_�4���;(�3��?�W��?ݯ��(,6�����8���ⴓ�/�ۺ~w=��U�ׯ�ٓ)f�TD� }��ʾ��=��>hcA�o��]�����y��
��Ĵ��w8Hл} �|&k'���]��~���z��1j�K���d|��Tx�o�<7o'�{��z_>�Ǎ5�|M�OR�-��̧���~���� v�C�a���B����?�����y�\Kz7e�F�����O��w����<�ߚ>�k���^�̓�ʁ���<7��Ɠ�-sB�h,5�X[�G!�3\�f<�R�G��<K�ԅJ|Н��4}E����xKHm'K�Vծ�Vd90�s���������wbIbrI�.�'���w�g9g��I�� 4����ǀs]x<��$uow��3��y���V��1���-��}ƫy��-=Ĭ#A�M}=��t��c�Q�����-�� W���ρ?	�����W�]�g�S�z�� 2�k5�*Tn��=_��-���ӎ70���Q{/U��^��G�K(�F�P I�{��ϊ�'�-ɾ�ͺ#)k.¾}�W�5�]^f]-SJ���s�f�,6O����V]�����3�u�y��_Ϣ��]���y����e4��[���@�����О3�gV�� �у�s� �½p�t�����G�S�-��:SK���O�����4[;�g��亄 s���\����+F�l�g�'�U�` ��n}�j���0��"��a��UM^2_���zS�x�
��M����|'�j� ��Q��<�:��E�����Ǟ
��{�M��F7LSc捻_x�×��n�����c=�v"�B�3�C�zMo��~�5<���KZ2��}������<�[jI��Nb�m�bc���o�������_��+���e9A��������P4������t?����r��}j���>߀�]<�����=:�������>'��,ڵ�y�t�-�^>���_!'��	�.!�)<n�YOBZ�c�o����6����B$/�CȮ̃�}5G��P�ՆeMi/v^��i�/|��'�6���J��b��
��;��5tm��Gq_���=+�σ~(>(�}�ܻfh�ɓ�����&"+]��t�y�9:�|����� C�������4�s�8��a����V�M[K����4dq��Z��J��,�
��}�t��W�eA�w_3��,������j�����_�ωχ~#ZF϶�6�;g����_f����ۥjiz���	VA��s_~����ZU�Ҝ��W���q:�����q�xw���j�G�k�� �_�⿵��.4�'XE���o�O#��|�_k�m҆���X�.�"A2u?���q��{YK�=��/�	��{�Xl�ڥ�H��Z?�D~ɞ 1]�:C��n{�?Ҿ��=����Ym'�n�9r��F�}��W��d��i|I?��+�1Y��_��ϑ�i}i�f�E��)/���u���O�g���-��O�Q���M�����UN|;�V��?�2�g8�-��������Tnǎ)ۏ�kչ�W�u����n?ݢ��)���h��E�㩍��R�?ݦ�w�(lM�QM��F���.;����� v����\.:�n���7��p�/�4�1�x�n?ݤ��E7q����i�wE7q����h�\u6?�F���j���.IE7q����h�\u����n?ݢ�q����������i⋅�����p>Z]���\.:�n���7��p��)���h��E���֝Q�;ӷ��q\u����n?ݢ��)���h��E�㩧�7��K��(��?ݣq������� v�.ESQE S#���>���iuQ�QE1�Q@5��S_� Q�R����
(��
(���֝M~��N� ��)�(�� )��u4��I����)�(�� (�� j��N���4�HH(��c
(��
j��SW�.��:�(�0��(׿fK!?�眏���f����e|��.A� mf~�O���W�{���J~�ߒ?�8��I	4�� ~��_����i��� Qm����x�zW�	u���C9��D��^k_O����B>G��OU��qR��ݧ�}]�5Y?��la�.]�� Z�w�"3�dן���t`:�e�Ա��X��M��$.C_���q�vMdTV'î�O��W�5&��_�ݱɒ��}���eXۛ��x ɒEO��s)��Y��c����yh/�q�@FC� ?�}�������O�I�9~o�	�΋j�f�eh�R<`s�Ӣ|;��V����ݸ��~y�3�<in ����a��"7�W��>���*CNX4�j����(��?��0E W���:���ws�<	X�?���*���y�I�wE@��C)oU�+��*:t.�C�87,�i�B5�y���lzȐ  �
�� �� ��}������"�����d�D��p�2O�|_�?�R���W���®b�s�Q����`#^��?m�,�Y.*�*h��W����Uծ���o/g{��[s;���E��$����JS����
(��#P�rA���~�e�I���6��-�Þs��k��Ʀ�����9�b�����b+���*��ק��d��#&�GE��tk�� #�̯��<����o�M��1����+�>��x��v����z0�֦�����_Xȡ�xY0}H�����a+�vz�ԙ��}�J�T����tτ��?g���`w��l��c�^]jl�n-��E#!�*��ҼE����Z+�l�g�Ҿ�MW�(>��XʱS�s8�����/f��y�����O��>����x0H@�G#5�P\	��E��~5�� �%���\8kyR@}���]Le����+����#�s/�w_��:����5�k_Lfȍ�e��Z�νk�j�6�9��8�6G��}VaMU�I|����<>w���~�o���̯�>:���P՜���f���_2�Ӗ�W��n1��ۯ��)���n����,2����a$�������G�֬u?��,��2C�1�W���O��ze�z���ă�9�W7��('ٟ��uW�5�/��=C\�_���dK�>�E|y���� ���}�[5�ϋ-���mR 0���\�4y��}�t�����ɼ|t��� ��|�[־�Y�(>��ӥ�>�m/�%V����4���>��ѩ�)g4��	z��Njx�]�_�u�m�L�� E>2�]&>�� *�R�����~�Y� �e�� ���U۔�\?/f|��t}�o4����N��ju{'��B�(�0��( �7��O�7��I����)�(�� (�� j��N���4�Ka ��)�(�� )���u6?�K�����)�(�� )��M:�� t�����t� QE QE ��>��k�Zu!QLaEPM?|S���LLuQLaEPEPEPL���4�dw��]G�E�QE ����M�hGAKH:
Z (�� (�� k�Zu5��:���(�0��( ���)����&&:�(�0��( ��(���:��xө! ��)�(�� )�ҝM^�����(��(�y��>V����������/ٔ�5��ֽ�&�K��g���`a� ���)�'�o}� u_b�� �Wo��J>���� �"����+S��?�3����/�)�e�/�׀4E�������j��n� ʲ~� >�� ^�V�dO�"���{?�t��ߙ�g�J9<-Ғ� �O�[����)�&�O��Ȟ��υ_�PtO���55�^G�6Q� #,?��� �#�2�G��r�F�3�����^˓^/�L��G�wo��,5.Z�g�%����_�R>|�R��?j�W��yֶx�G�1�j����ٔ�e�� �D�F��Cj��?��;	G�У��4uv{h�_�ꚯ�� j�s�˥�$ep8²��+��?����P�7o�V�E}��_#|a� ����Q��q`���oC��2�-,M8%>n[�m,ݿ������xF�F �^+�
�3�D� ��� ײ*�x�'�1O�o�W�_��Y�WU�-��|Jĳy$�ٞ<'��c����W�G�,#"�No�Xh���QE韊�Q@_�i���ƝI	K~�z�M��br �8��^�+�� fs�X� ��� �k��k�S�&_�{u2,+��6��G��-�������[���b�u5��S� ���� �ɮV���?�sH�c��='/͟q�v�M�i�w[�� �E`�[O�|:���#��� >5iq�6�v�7�.m�"��*�t�?�2麦�>���nZ��laB�Z𣅒���Jb��*��N��W�6�o�s8���s�+�~M�|G�?�G_Ҽ������Q4���j��9/#�� vͰ�<4}u�W�ߴ�n��e� �l��{�MxO�2rto�׋���U3�O�b�A_��� ґ�U����?�R�韻s�|�_E~�G�� ���"�<\y�4~)�� ��i����=�̯��"���izb�� �}��_�J� ��[� ���uǁ�$����_Qÿ����u�.�>���`O�W�U�ׇ	���� ��"��C�D�|/ֶ-yG�������B� ��|y_`|U'��� \?�a_��c���"�eA��� ۘ��N��juz�B�(�0��( �7��O�7��I����)�(�� (�� j��N���4�Ka ��)�(�� )���u6?�K�����)�(�� )��M:�� t�����t� QE QE ��>��k�Zu!QLaEPM?|S���LLuQLaEPEPEPL���4�dw��]G�E�QE ����M�hGAKH:
Z (�� (�� k�Zu5��:���(�0��( ���)����&&:�(�0��( ��(���:��xө! ��)�(�� )�ҝM^�����(��(�w��FS[���k�6׆~�s[���k�k˭�g�WT�Ȱ��_�S>I��� %V� y�\Ew��j��/��+��F
?�3�|�� �/�)�\|#�m���D��A�"g�"��K�m�Ojr�H�^��Y� 
�;D�.���ZM:�[Fn��k�(�|I"��{-�^�ہ�W/����C��x��K	�_�Q��ݭ~� /��<��>� �B�?��W']g�(Z'�|
����r�l�� ��)_����4m#�����^�^-�L� �H� ��� �כF6�?��¥�,J�_�R>{�|��Flu����ׁ׾�̟��� �D�F������p;��h���,����7��(���u�W�u�'��(���u�W6ZL�7�y�e�������6���� �7H� �t�U�}���t��O�ZbU�>c�Yr�1�_��=�F���� ʾ2=k�� � ț�׳*������x�.l^�/�
(���B�(���4�j��N����?fk�Η�A�y�r���ی׵�-�ujk{�M�Ɍ2�Uǡ�k_���i�kpٳ�֖1�~��R��;��N�l[�C�O���e{���~�'�.�;�kr���k���R����ĳ1�'�4�ڕ��űU�&�J�[�����6?�N���h�ru]��O�(�o��W]��?�(�o��T��g���f�g���h��mxO�40to�׼W�~�}to�םF6�?�x֧6E]�� JG���_�Pφ�?�����k���B���zn� ��僤��61�]�����oc(೚Uk˖-5w����Cm|s�+�G�o��_����ğ�Zs�ɨ�.)L���I��V�5���k�ZLzd�x4�g�x����С��5)&ގ�V��
�kÃ:�� \�
��������4� �����ī�q�i.ZدH�l���?��k���� f��}��W�I�� \?�a_��+E�^$K�0�����~��k��WQ�P��)�(�� )���S���Rbc袊c
(��
(���xө���:��H(��c
(��
lv�M����.����c
(��
k��N���4 ����- QE QE 5��:��֝HAESQE SO��i��ESQE ߛڏ�ڝE+
�~oj>ojuX,7�����T�����E��������QE�a�7�7�:�,�{R6���>�� t�`��vJ_�ڔt�X,7������QE��~oj>ojuX,F��:u�|��?A��QaXo��G��N���~oj>ojuX,7������J��~���X>oj>ojuXv�{Q�{S���a�7�7�:�,#�w��B��N����{Q�{S��a�o��G��N�������݊���)[QX>oj>oju�;�������Q`���>^��u��׻c�^�0��s���w�qԏ�Mp|�rZ�_�S>F�׻�N��}�� �Ep�7�w� �j��/��+��������b����b�i�lh�7�Pd�4۶�ch��ԃ_S��>���F��ۤ��i�<��#�
��g���<'}9�H�-�2�2�Gc�Y��c�#�U��sڮ~^n[t��~��>J�����O�������t���G��=��h֌���L}���h�J�O�s#F����� �׶�S��� �6�� ]�� A�Jq���ŕ/���������^� �0��:��#^^� �0� ǎ�� ]#�F�*+��_�_.uE� �� Ig���_!|c�� #Z����W�����1� �Hֿ��B��3�o'͗R_���|�����G�Q�?�{'�+� ���4��O�UU]#�<<�.*��W�'�G�Q��O���_���_v���yo$ �)�FX��7� @{o���_��;[>�N�*�<��o������������[�o��������7� @{o������������ ������������[�o��������7� @{o��h��!�/���>/�w��_f� ·������_�V�� �=���IM�C�_�� ��ό~oj>oj�;���� �m� |Q� 
����� �)�D����?����G��]7ċ(4��6�Ѭ0G9TE W7Z��<E��:-�ŵ�;����=���C��r��8";p���/��!����,�m��2���5�𾗁� .���?�r�����9�b�y��~�[�����*k�B��ok��l|i�{Ww�G?��� ����������m3����KF~+��a������<}+�� i�s������ ��]���N6�?�8�|�-e�� �#�~ojF݃O�Q�%���Ʒ7W��2YZ�A�{u�ںވ�v�`+fX��h|R��O,�FNh����}w�ǆu}5�����m��h�*{}k�mgL�E�n�e� Yo#FO���JG��p�+$�u��l�~ڔ~oj�Ã�$�pO�W�U�� �9�4�����������[�͘_��[�w�����W�7�}��\Ż����+�t����������6��N��ڇ�N��~Wa�7�7�:�,;�������Q`�ߛښwo*Jc�4&��������Qa�o��G��N������|���(�X�n�zS�oj�u$��ߛڏ�ڝE;�~oj>ojuX,7�������Jlv�j+��G��N���~oj>ojuX,7���m�OJ}5���a���7�(�)h�Xo��G��N������|���(�X��`t�N���~��N�°ߛڏ�ڝE����|���(�Xo��M;���%4��CBh>oj>ojuXv�{QN����(�0��( �G�}2?����.�袊c
(��
k��N���4 ����- QE QE 5��:��֝HAESQE SO��i��ESQE QE ��ƝM_�iԐ�QE�QE ��N��J]E�uQLaEP�~���Ϭֽ��a��K�@Xy��� dW�Ⲕn��n��QE/?�)�"�l� ��������_��1�|G�&�@��Fk���ṫR��k�����߆��(]��֭���E=[����U_���"h�˺��������Y��DR�� 	�_�� �O�OS]o��(z�|
�S]o�o�(z�|
՟Ιv��?�揱*�?�w�@�?�wo����j�?�xěG� ��� ��J6g�\MR�Eu�4|�^� �0� ǎ�� ]#�F�����?��\� ��� #W%t~I�o�7�� �� ��ܿ*��'���o����+��{W�?����!Sf}�ϛO��8��K�?�&h� ��ʾ-���� "^�� ^����\�8\����_���Q�R�ڌ{Tr���Q?*?*\{Vn��-;�y�ܥ�+б彀�G)�F�\��Vh�T~U�����Ht멢�f@��]��>&�8R�S�w@d���~�rN>��U=��˷�w:�ʏʗ�cڎS���~T~T����r��>7��� %]� ���+������M{��O��N�[˙���������߄�W�� ��?��� ��� ����������?��?�g�N�@������u?�+U� ��/�?�$�λ��?�Q������1�|EҌ�3��Z���)j8�� 44}w�W����t_�׽׀~��1���02�3����l��8��yET��4x]}�3ȳ�� ��� �E|�_G�̿�,j��?�W%t~_��6���{�_�L� ��\� ���u�i����������Sc���|�J?��f����� ��� ^�� ���~����w~�&���[��S����$�kb�6c�W� �w�� ���W�U����~�FF� ����=�dr��������ڝM~��g��B�(�0��( �7��O�7��I����)�(�� (�� j��N���4�Ka ��)�(�� )���u6?�K�����)�(�� )��M:�� t�����t� QE QE ��>��k�Zu!QLaEPM?|S���LLuQLaEPEPEPL���4�dw��]G�E�QE ����M�hGAKH:
Z (�� (�� k�Zu5��:���(�0��( ���)����&&:�(�0��( ��(���:��xө! ��)�(�� )�ҝM^�����(��(�O��� �w�t�ӏf�zW�ꟴ_���緊(-ee�� ��J�ȡy�X�F�F8
�$�ؾ�N�����&�+|g�h�(=l.7��(a�%����,�s#K+��fcԓޛH�tR�y7oV}����DM��֮x��E=[����U_���(M��֮x��%�� ׳� *Ӕ���S������|Dz���N���W��2������X����?�iT����O�>���k=V�;�[���0ua�W����.��n�4�9�v�&IYB�����qyP^Og�$�ʫ�b�K1�ރ�3>)�c�xeO������+��{�<u����5��}�.� ǎ�� ]c�F�Wg��/�4��&{�|}��JV�� ]G��+�ό��R����?�TՏ���`�� ��g_j��D�����W�U����� ^�� ^���%s���r�+z/�ޢ��1U�~��F���<cq�]�do��9�(���S��}w����>�6��]V�e ��ԟ�RrKV>�+U��8E����hsUoJ�.t]B�IZ)�`��qU)UK�U�� ;���H��JQvh�s�����Zv�>�
���b���Z<����I�, �=�溌V���~��B��|M+��Q�S�F(�:�����(���|��\�u�� ������ҹ:��r�닫�)~l�{��+����V���u���?�V���R�W�{'�� ��x\� �c��i�~�Z��'�q� �'��y䵞9�s��ee8 �e���N��}?�������Coq*��3�Z�x�� �:�����i߹����(=Ne���S�Q�+�
�C�d� �cT� ��� ����������X�?���"�Wg��ϗ3�������������_h�/��� #��� _O��c�8�|�Z_��b��|d��g�(�]ك��o��਩?/�b���{\<�e�v:�����$W���!��������E��U�Tuk��O������N�su
(��(����>���&&>�(�0��( ��(���:��xө-���(�0��( ���i����.��:�(�0��( ���4�k��@
:
ZA�R�EPEP_��ө��}iԄQE1�Q@4��N���)11�QE1�Q@ݞ捞斢�uݞ捞�CQ�����K���Qr:����$����ѳ���z�����ѳ�Ѩj:�� tѳ��2�O&�CQà���riv{�5GQM��h��h�5E7g��g��P���Ӫ7^'�;g����E7g��g����E7g��g��P�u4��F�sM+�M'q;�QM��h��i�=GQM��h��h�5E7g��g��P��uF�<�v�sI\Huݞ捞枣�uݞ捞�CQ���F�sMT�-n-I(���4l�4������4l�4j���4�z�P�uF�5�[UU�0�R{���T���D�H���+�+�?e��z��?�^������<?��[�� y��x�V��m�]Ⱦ��q��+]��� �����K� ����{�喍��rP�U�V�O�>��h?��?��j�G�RZ��{?���Pz'�{-\�� �GW� �g�U�ˡ�<*��������4u����k��m�ëx�F����w)�+�]��R��R4�V��Y����[�[�m.C���X{
�52�H�������ᣐ`���#X�Q@UQ� �W���=�&����vh����淕.Ut}�e�R��]zSm����:��\#�Z��ϙ��k罞�� ����k-sy���BO��޲����2�\0x�V����}�����!�+\��ç���cU���ѧ1��������O�|��_Ϭj7�.^yܻ�sZTkd}7�|eQ�.mo��폇��(�����WĻ=�}���e���"��n�?���2�I�׫�3���b�WO)�g���� ���5��k3��(�'�� �kԱ^_�Dj?b�}$!���ȃ�95���+5�9`��Eug��>U�]��<�x�V���̲ؕh�?t�����{�h�>��;�B�\۞�'5�d�?(��>����� ��N���Q�v(�v�{Q���Q�9Cڟ�X� �����W']'�مߏu�U�嫙��k��~��6&�_�� 3�?�������O�+;�x� ��ױ�b��?�ҿ��?����-��� ^������O�j�� b����������5{B��<A���֣t�}��S�ةI��j�tWҚw�ˢ&��yws-�_�Dl(?J��_.>��IL���e�7/��i(J*��+)��骵c��ާ'_H��#�)�S�����+�͞澓����9� ��� ��t���Ò��"���{>+����?���� ξ��|U�=s�^��^��֕U�>���͇��/�樦��5����^)-��a5ү�>Q��:��~kN��a�#��׼+�xfq�g-����p~���{�Z���e�%fڝQ�����l�4� uݞ捞枣�uݞ捞�CQ��� X)v{�i_�ri;��QM��h��i�=GQM��h��h�5E7g��g��P��uF�<�v�sI\Huݞ捞枣�uݞ捞�CQ����=�5#���ũ%ݞ捞枣�uݞ捞�CQ������摗
y4j�-0'�K��Ѩj:�n�sF�sF���)�=�=����֝Q�����斢�uݞ捞枣�uݞ捞�CQ����=�4��94���IE7g��g����E7g���CQ�QE1�Q@2?������ƗQuESQE S_�u5��- �)h ��( ��(��}i���>��B
(��(��~��SO����(��(��(���4�j��N����(�0��( ��Ju5zR�.����c
(��=� �Z�]���k�q^�,� ��~�� Z������G�Y5N\5������S5��� A��y���Jf���� �"�:���3�k�*����ϵ~����O��Z��a� ��� ^�����1� �� ^�V�m� "��� ^����Q�OԡS��/���ç������m��r������}��yq���VLE?U��f�?���4o����{�x�I�  M�����^�X��/7�|E�n��������X� ��d��@2l���Z�c'd~cB��*{��(���o���Ӛ{/�ͷ<d�����~$���޻{�Ns-��	��5�JR��ۍ˫`l�Y��ͯ�g�muO �l[2�Hb+��������x�|3��cp�,��O
� ����-N������m->� �'ո`R���>S�j&x'�G�m�E��y��+�+��^K�񭺼N��n�7#�'�+
��<�X)%������_ٟtw'$�Sb+��/���5�Ѥ�n���?0�>:4~q���Z]�Ϻp)p)��xcb�IPH=�����Q0*����]�H�R�BI�v�{����]	گ����?Ƣ~�[g&/��%U�_�C��N�����u�V~}�j�W�~<�n������)m+���� A��D�W���{�+K�� �+i_�����?�O����?�W����T�����C��~�~$�y���W]����)Zg��W����]�T����}}��ڑ@}�8�}^�R�����V����3����O�_I���>�?���"�l��?e���O����:
�>;"�.:/��G�b�*��� %^� �����⟉� �P5���z��+E� Ϛ�?_��+�� �����kh�@�H�#$�������� �{M� �t� �Eg�Wl�ᶣR�������T�y�I4j�� �'�*r���+�� ��N5���� �
�!ZHǈ��0�����ڝM~���>O�QE�QE �� X)��� X)11�QE1�Q@Q@_�i���ƝIl$QE1�Q@6?�N���iuQ�QE1�Q@5��S_� Q�R����
(��
(���֝M~��N� ��)�(�� )��u4��I����)�(�� (�� (�� )���ƟL���4����(��(��� tө��M (�)iAK@Q@Q@~��N��A��RQE�QE ���:�~����QE�QE QE 5~�SW�u$$QE1�Q@5zS��җQuESQE��>Mw���~�x�>Mw���~�{xxޒ?@��[	����q� ��������ߎ�Su���� A�W�S�~�����~o�>��d?��?��j獇�R:��{?���PZ'�{-\�� �GX� �g�U����#��� fK������]��/�(��|
��Z�>� �Hп��W����ݫA����?�ߵ(� �&�� ]�� A�r�xo�MƉ����5�W��3�*��M[����X� �w�����|�_C���6��u���p��Q�S�����G�b�6��� %3\� ��� A�V+�_�?�Su���?�]��h#����B+��8�E���	WS�GcKLo����Ϭ�|Q��:Dz}�5{e
T�y�:0�O�|��Z5�7�s46�u8"���i��O�$QX���
$c��?^ƽZ��,�>�/�T�Vv����	�x�{ƾӼs����|��e�џQ]
2ȡ��)�09�����=��5"�5t�� �X�� �9s� ~����4��Ix%mB��̠yc�W�b�Vk��p��aiIN�	�1K���u�CE�-����k�|���>����y��F�y��O�����,څ��Aؙ�۰��Qw�z�S�b^V�W�/`*��~ j^>�Z���B�[��P�s�׫����f9��K�?
�|(�S�>��p� �WJ� �d�B��(������{�+K���)]'����
���?��k�����}����N��3_���+��� %+K� �*�k��� %/K� �*�)�k��� 툃�_��+�� ڛ�h�G��q_?~�����lDmI�k�T��Mz~h�
�W�]�K���?�_5W�߲�υ�_����?�Q3�K���=��G�� �(:��}=}�����u���z�ūE�w>jP��^����� �{M� �t� �E|'_wxd�=�� ׺�"������gS�`�[�m����� م|__h�\�o�׿��+��Z���w.j���F�ju5�S�����ESQE S�`���`����E�QE QE 5~�SW�u%��QE�QE ���:�ݥ�]GQE�QE ����M�hGAKH:
Z (�� (�� k�Zu5��:���(�0��( ���)����&&:�(�0��( ��#�Q��(h���dz� Zdw�dz�ldm�ޗQuE&G��#�S�Rdz�2=E -5�����F��!
:
Zh#�\�QL��#�Q��(�Rdz�2=E #�Zu1���;#�R�Rdz�2=E1�E&G��#�P�O����H�9����I��(���-����Q@E&G��#�P/�4�`#q村�)"P�Rdz�2=E2���#�Q��(i�җ#�R)�)u�)2=E��Ţ�#�Q��(�?e�n��T�t�dT��U�q�@����u�1
�d��W�v��X�$��43!ʺ65��_�Q�i�gs�\InFһ��^�R�V�w	�GK��7�?Žb�\���]Z�x�U�C�?�r���ir=Ep�\�˹��~�No��g��j�X��y+<�R <�Z��CZ��<�Ks"��4Ryf# 
����-ռ-3K���f������� ��X�S�j���{~�v�~�,Z�|���Vh�N_z��1�t�5Xt_hח���z
�=E��y���䒒�~��*O�FVS�E|��Q�vҍ'L�E{�٥u;F03^M�|O�6�b,�������@��ҹ��B}J��.�i�s�wl�]�qJ�9R=�Vg��8���C^��.kV��Z��$���0����#�T�w�i�)qm3A2��`��S��H�����UT���rH����d�8 W�?uh5�k7����a�қ��P�>�bl�m��M����[p=��URI��tqQP��B��;#�SX���g���	 ��dz�2=E1���~-���;R�������Z��#��!@Դpǻ[�3�������Q[½Hh��K^��e��
~Ӟd�Y]����n��Rآ�c�K#�38���2=E��x�����<KV��zo��h/��^%M6୸��:󋛩�&ig�摹.�$�pF��;#�W+�)�'sΝj���J��I��(��&b�I��(�����=j�\�V�=���aTp*�`�Y�u�m�ȫ%�~LHO,�����Vc��2��ʍ��*sŚ��fj���:�� ~�<b�嶧�<�:ϗ޵����~k�'�*��p���z.F3\nG��6A��>2�jH����Mt?@��E�2��GC_7��ݵޯ�i�ȲMn�҅9�I��{�^(�,���q�B��sWW��\<���9�;��k��)T�*G��̣^���mr:�#�\֭��U�E[�(�P�Yq�+�l�QV,5;�&�.l��t�^6��J�����a��^��k�|\O�4αĀ�; +���qk0��`9�k�e>�5gV���]z�������`�l��gp����Z�#���)(�Y!k���ն��2��Eu�Xʐ0A���=Em�{ƺυKe�3Z�ʍ��*p������XY���>���[i?�8��D�H"�3���+��׼U�x�q6�}-㎞cd����QS^����8�R�T�J�����#�i����<Z)2=E��Ţ�#�Q��(i���S�=E0��sI��QI��(���-����Q@E&G��#�P/�4�`#q村�)"P�Rdz�2=E2���#�Q��(i���\�QMB6���]G�I��(���-����Q@M�ir=E#���HB������#�Sh���dz�-����Q@�֝Lr09�N���-����QLb�I��(�� ����.G���7�i11�Rdz�2=E1�E&G����ҍ�Җ�,h��h������=)���ӽ>���i[Qu�zQ�zR�Nð�G�G�-X,&��MuO�k��J°*�)v�JAKE��m�m��S��&��F��KEuw�m���}iԬ+	�zQ�zR�Nð�G�G�-X,&��M*7�)����&�лG�G�-�;	�zQ�zR�E��m�m��Q`��Q��N�=)�u$Jh��h�������G�G�-X,&��ME�O��JV�V�]�ҍ�Җ�v��=(�=)h��a6�JFQ��N�o�iXVTmR��/��X�G�G�-�;	�zQ�zR�E��GS��JG�N�auh��h�����a6�J6�JZ(�XM�Ҙ�7�*Jc}��К�zQ�zR�Nð�G�G�-X,&��F��KEU���ґ~�T�P�G�G�-V*�m�m��Q`��G�65zS���V�Vh��h�����a6�J6�JZ(�XM�ґ�m<S��V�UG�G��E-&��F��KE;�m�m��Q`��Q���ґ�S�X]D�=(�=)h�a�M�ҍ�Җ�,h���%1��
M	��G�G�-�;	�zQ�zR�E��m�m��Q`��Q��N�=)�u$�Bm�m��S�Vh��h������=)��oJ}6?�Jڊڋ�zQ�zR�Nð�G�G�-X,&��MuO�k��J°*�)v�JAKE�M�ҍ�Җ�v��=(�=)h��a������ґ��:��&��F��KE;�m�m��Q`��G�4��8��O��B��m��S��&��E-X,QE QE ����O�G�]E�}QLaEPM�i�����t������(��(��A��S_��ө(��c
(��
i��M?|Rbc���c
(��
(���xө���:�
(��(���)���K�����)�(�� )�ZF�������~襠K`��(QE ��N��ju!u
(��(���}i����I����)�(�� (�� j��N���4�HH(��c
(��
lv�M����.����c
(��
F������~襤_�)h�(��QE 5�S��ڝH]B�(�0��( �7��O�7��I����)�(�� (�� j��N���4�Ka ��)�(�� )���u6?�K�����)�(�� )��M:�� t�����t� QE QE ��>��k�Zu!QLaEPM?|S���LLuQLaEPEPEPL���4�dw��]G�E�QE ����M�hGAKH:
Z (�� (�� k�Zu5��:���(�0��( ���)����&&:�(�0��( ��(���:��xө! ��)�(�� )�ҝM^�����(��´tj>'�����I/.�8X���(���y�}f�L���up�G�z��+�kK�U�D$�W�A��a��A�+����h���5Y|1�_��}M�Uͪ;i����_?b�>��[~і �+S�{� 
���o�w������ZN71�����i����S����L����^�o�OºE�æ��j�x�A��k�Icx���9Q���v+�_{��S���<R�ʟ��o�=6����A6��.�SW����+����xr�].璱Hw�O��Sҿn-�uK���6<���>����ῈV�mR�v��|�/�je+�֫T�H���G�Ad�������[3����{ឫ�-j�Ÿ�.e�$��)_b~ھ%�&��b�T�BF���_��Ofx��-���C�n���W��fq����%B�����}q�*|�爼*�"�l�Ԧ�B�E/*�{z՟�C�g�a�$��%b-f��-!+�r�q?�������� Ω ]6���x���5���w0�`$��u�O�3�!�b�Q�7x��W�����yV��j�b���}T�����`��:�����$�	֛^ҡ'G�}Ϊ8���5���W�P�p���ޒ�T���:�
�Yj�0'�}g�4��V:���"�e��nm��m���_�W�Y>!x�5]F"4K7r?ְ��}� ���"�V8�]��` +�;�z�u������9-ג}��s�Y��ى���S��|��Q�	�΋�<A�XǦ][0��,�}�k��g���ܾ �o	�2����u*�����5}�Q���!��&��j��E�{���q���IaRIh����@~�?,>&Is�k��K�}��y���_Q���� �-dqܭy��a&߆�#����f��|��cQf��r}�~+�Y�m����V�J\��[]�ul�%˰T��W���I�g7� �����[/�����/-�!�xo�*��k̛����b�|Fx>j��U�����ޛy���s��P+�q�%���?�Ø���&�o��  �>.����ͩ�By.c�k�[����ż���3#E*��0A���];W��,!���g��C��!���?l�v�׭�Ea�����T`��k�/�1x�G�ff���=�?����!�)a��w���ꏜh���������e���hcĞ$���+ojN���׿� �9|7� �V�����٦M��A��:�>%�P�>xx꺚��[bE�v�����1�s�=iߝ�1�kgd���~_�`0�|+U�mʛm'��� �����[/���g/�� �*��5�?���� �~�����Q� ��� ����� �o���?��� � �~��w���  �o�g/���e[/��d��>�� ~Ŭh(m��\����V��E� ���?�^�� ����_~<��a���-~æ[c��X�Rk�W*�6g
��MRW���V��z��^KW(��\�Y[�G�W������G>"���e��jc�5�=~�~ʲm�9�v�u��y�b���K	7JI]om^��>�pt���Z��&��c�l�o� Bͯ�h� �l�o� Bͯ�kw��}3᷇e��B�;V8����+ſḼ7� @;�����_��p�Q�Su���(���{���N)��)�<B�_k�=R��~�6�%У�'��b�?�� �?���U����{�@X�O����w�k�4?�G����yiy�#	\���6>"Ӣ�Ӯ����ed���a��OԌ�2�+�?z/����2�dټhr���?,��.4˹mn�{{���� �SU���7���5o�h�x�J�c���T���+�&�k�#!Ωg�%������� ˱�Vk������[����?[�E�����r�d%���*;
�[����xu��tXm$	�;��[�5���Wy�X�����q�W����6�-m�ٸ���w������'�a���aj�4���ڴ�����>Å)�4�a�A9��W�������Ï����cbb�H���^�B� h�� �0�*k6�^�Lr�����t�&�{;���\��E}�
�3����$�U�ϛ���x�/�[?��W����«ߊ�,�O�Y,�����_�5��s�׾*֭t�>5�ÄU��~�|�ce��pXB�ײ �3�o�n.�5��9(��O�������m����+�M~�;�������� ��83�o�1��������~ xi<�-WH�O2;Y��Fx���5�]��W�I�����KX{���
��ֵ{�{U��.��sq!���$���uҪ���Ԕ�Knf��ի�Ǳ�q��t�P�S[۷D�TQE~�~|QE �� X)��� X)11�QE1�Q@Q@_�i���ƝIl$QE1�Q@6?�N���iuQ�QE1�Q@5��S_� Q�R����
(��
(���֝M~��N� ��)�(�� )��u4��I����)�(�� n�F�K�1KQj&�F�K�1F����5���M���4�������.(�=G����.(���o�੧b���h�58���)@�Q�5D�(�)qF(�5x�x���P�c���ӷ�G�>��R�Z��Q�R�S�z��Q�R�Q�j&�M.7�~)�|⓸�x�x�����x�x���P�M��b�CQ���N�) ��;�Į&�F�K�1OQ�&�F�K�1F����"��;�8��Ũoo��&������6�%犮���6ۇOR+������%ާ{ K{h˱>ݫ������C��$^k{�^{�ax�]?��:\.T^��㺎��ۍ�>"�NoG._H��?{�F&F�%���[� �>v���T���M<�<zr1������zן3����F)��|.�
�ha���^"�\MIU�+Ɉ�0*Վ�u�K�Z\�m'��r����>QK��qRV���-�S&��g�&2��%ħ��ŏ�Po����V@�n��'WF*�r�}��1|p_�	��Va��h����*�+�lV��u���ڕ���:��~�y�IK<�:���}��>����2�J����K�� 3������4K�/P�f��B�t����?fG�h�[H�;K�_� �=���O��m>&x^�-�`%�9�[��k��y�_��َc�U+a��ލ>����?i�e8,��,Czn��?�B���3a��i:|k����ה�ҿ����F�0:���O1!�k����&��ǅ�5+�l�,��ڿ>�W�{�k�Z��)��w,rz�W�¼;,����a}~Կ˹��.m���at�]>�� >�T�-q3�#��ff�L�)qF+�+h���>�������}�]�C(?u^{��W�?}��GO����ּk�k/xr�G�,-����ՙ8a��x������߲�4�9)CyA�~h�o��~Ś9'!���O�O�m��+覻���aC�*�o�
�~\c�%uQ��u��Ǆsv������qt��ϵఏ�s�a~�o|2��ǘ.Wez�����t6Q��(DE� ��l��[�J0B�i��i�v�l��9B�7���^�ܿ7c���,E:/�q�_���.�F�K�1_Қ���~����� š��?θo�B@|	�������t�o�]g�O󭿉� t�>:]��V���C_���S���u~ԓ{?�������B��(+}����(�+�_�b���+�����G�1^�� C���O�����~?�_�~]��f� ��}��ϒ��7�����=����}>��+��H�:��^��L?����i�D��n���8���M��������/��ξ�}��0ɷ��3�[�����?i��}~L���	��h������[��ʾ"�+�_��M�m��<��_���B_ޑ��	�ѯ�7��?�;��ue��;,��w(^4c��=+�W���^�P��uB-��%�d��q5U��񭵴����FA*����-��:��:լZ��yi0�20>�1�Wb�G�u;1�	��k����m�����I��5<kz����{��%�vL��Bt爏ٴ~�O��F0��ֿv�"���M����o�#vv}*�\�����G�)q_�b��%���+3��6"��kRv�OԽ#Z��4�{�9Vki�::��|��K�����r���O��?���~�� �B��������ض��������L�9��jaq�!�sQ~��������O�Zk׼_���_�� �@t��0��6�¾�Z�?x����֫�L"��Bē�����a��v
�	$��'��Oko�i���د�k�������-�\C�y>�v_����V�p�^�Ik�WV����>-|N�����+�"�6�!�ڸ���Jv+�3����U�d���V���*���boo��ө��oo��j��SK⟊i�⓸���(�)qF)�=D�(�)qF(�5x�x���P�`q�ӷ�@>cN�%q+��Q�R�S�z��Q�R�Q�j&�MGi����ikqj.�F�K�1OQ�&�F�K�1F����#8�iؤq�5D0)w�P8b�CQ7�7�\Q�5D�(�)qF(�5�0>�����N�-E����.(�=G����.(���o��x��G�(w����.(��Q7�)qE���E�QE ����O�G�]E�}QLaEPM�i�����t������(��(��A��S_��ө(��c
(��
i��M?|Rbc���c
(��
(���xө���:�
(��(���)���K����h���Я�ڊ^�5�dVuS�Q^C�c��\h�5�c�VF>�U� �O�i�xJ}Gh�}ʤ�Pץ�K��>=���&��\t�����Ԛ�I���?���Q����������H�t֎��^xkV���hn!b�0��Y��M~�)�J.��3����j���KH�tR��
(���Q@��8����_�`I[^�&T�=}��{���c���� ����?:��,,6"�q���ܸr���	=#->h�����uν�{���b�3�{����~:�P֏�4�
�NʩB�� ��W�~K�T�\¼�����(�T�ϲ�dy6�=���^O�l��`�����e���� ��t�~��y5���W/��Oc�'h$w��3,
��U)7ni����U��AOk��� qѷ�#>%�[�)?�y���k?�{�+���?�� ?e�������� �0�����+xO^�[k~��v��O��Ԭ�u�m.�Y��R��25��Ė�$�;G"�)����=��|<�/.ش�=�ǩ�����j9LaZ��M�]��eüB���^�M+�[u>I�����׌%��O�}�e��O¼澬��l�úU��I���S��r,ULf�J���~O�xeٕJ4�y_[z~�2c�F�3�'��y�k�:��jq�['ޖS�+�g�6�-��'��!�[\��E�+�V��~=<�c�yP���޿3���^_���w'o�=+����f����(� ���_��� ���Ϫ+�?�l�����G���3�|��� 3�o�<;}�۝F�MN��m-;P~5�MW��YU���B�����slھo_��IYY%�
���g�	��������{�m�o­4{���({L���ϫ�U͙K��GE���|N�i�\�k�q$n�+����� ��^%� ����k�f�TR��Tu'�*�zՔ�/ w=dR�~}�f��[G�៻{�s�,Ǉ2�ʲ��O�����I��5in��CX�����BX�l��� ����EM?K�h�$���>��ߝ\���M��j����h�
���������VwM薊�a��2܎�Ӆ��mݻy���>�>{&S�S <������nbrO$�Ǌ�Y�x�X�R��i�$=�(���t��Q�췓տ?���q,��h-"����_�)i�����o|g�[iv1��V �8U�M}�qs��G�ҧ:Ӎ:j���|�oy�[N�����68�袾�G��<(�q� |c�� Ö�e� Us,��۹5��s�%��66���Q���؜q�k��޽n �(Q���+�g�6Q�Pᬹ��J��'�/�S�/�[�)홈YP�#�F+�����߇�*���Vh$c$c�Rk쯅� l�%h+{ ܧ�5�rP� �C�k�էğKi"������z}+L�W!�J�uh�%��� ]�ܪ��#��;�+�����ڝW5���ڤ�}�F+��)N�n���4]�?��BN2Vh(���Q@1��
}1��
LL}QLaEPEPW�u5~�R[	QLaEPM��ө���]E�uQLaEPM�i�����t������(��(��A��S_��ө(��c
(��
i��M?|Rbc���c
(��
(��
(��
dw��#���.��>�(�0��( ���4�k��@
:
ZA�R�EPEP_��ө��}iԄQE1�Q@4��N���)11�QE1�Q@Q@_�i���ƝI	QLaEPM^��j���]GQE�u_|us�� �ڔ$���4�N��/��Sc�"F�e�	T:��5��]�Ï���ë�ֲ��������OC_-���0J�=&�~���K��7���JO��ӹ��ğ��/ċ}�I�{�%�C>���ψ?fi�I��� u��oʽ���|5�c�,/���N�}�C]�wI2����e9�O��2������~���r^#_Y�M�������ޗ�8x�P�U�!�Lലt�+���1h�4b]u� ��H��#_ý{���
��K�+�����58U��Y#s�[V�3b�p�� ʵ� 3?	d�O���n�j�v��/������X5}�?�%�x��u�?�2��yc�����6�~g>�����+�"�1�;��������g,�Z��h���AEW�|���*8�����x_�_{���� ���3��=�È�K�,Ǡ��K���N���������θ���^����?u���k��̿#⟎?u�� M+����֥��W��q$F\+������N/�_���hԱ��]�4�6QEu�a���&�\�x5��R��8�e��o �yW([�Gc^7�/x���L���'H.L�da�7�A_A���%̨ԡ�βVw�?�8v��"�E��Wo����f�#�֤z�� �jO�f�ϭ��� � �W�~o�o�z?��������g�C�������>L�?e� ��D��������&�a����Z=��4;=2��M�a=��In�/$��� W��I���B�X,'MCS �H�U�5�����erW�D��g�����<C�����~K��~�-���O�!p�e�����^����j���n&b�ƨ���~`pР�~g��s���Sk)=��p|�o�$��E���7�|,��{��� �VC��ٮk�s񵆣��t�:G}hH11�a�+�<�z��N�0�h�II�Fe�|>m�R�'xJ	;zk�L��������k� � ���5x��}m�� � Z���}��}�����v��� ����?�����3W������� � ����W�uo���V�kiO*z�c_~y����U�i��u�<rj�)�E��S.�1x�DiT���>k�x;�e��Q�ԣm�w��j|�_j~�rm�]�v�u�]}}�7kv��m�b�L���H�Ȯ�$���"�ٞ' �� j�-�o�?i�j�M� ��Y�9C�G�|�����uprHs_L���ժxZ��ʦ�I�����|�Zp�O��lˎ*��w�h��Q��_�� ���r^�G�<�\t�Z�mJ��V����1,)GFk���m:�+�ySD�����+쿃�����M"��n�<��B�;���Zë'��>���n~��� �q��K�o�.ޫ�G���O���.#R�e�-���^z�t��������pћǐT��s_#��5��N&�+
�Uj���?6⬲�U�N��{v�O�%����E(d�BUG$��3�_�ؼ����ծ�4�Fv�����Յ��=.M@��q
��7j�V�S�����y�;x�s9<^W�.\,��~~G�pW���5Zr��]�ܭ�_Y�'@���*ƿ"wv�|1�o�x��:�셚F�<"����f���4p�].ي�����2L�8
~�kߗ���|[�ڸ������L�� ��|1��y��Đ�@�m���,��_q�Ė�%�-�)D�L����~wW������WI���*�"o_�c��oM{��GW��}o��_���� ��=W���J�+�[\�b�v˙G2����c�F�X`pA�_��Z�T6�7'���_�A����Z��~�ӱM�=�.�U�Xyꣳ�C�2�>�<u'iTѮ���g=EWٟ��Q@1��
}1��
LL}QLaEPEPW�u5~�R[	QLaEPM��ө���]E�uQLaEPM�i�����t������(��(��A��S_��ө(��c
(��
i��M?|Rbc���c
(��
)���h��J��)���h��E�㩑��Ɨq��5	�N�����%����n?ݧq�u����n?ݢ�q���������N���-01��iw��p��)���h��E�㨦�?ݣq����ZuF�p>^������E7q����i�.:�n���7��p��i�������x�i6�QM��F���w����� v����\.:�n���7��p�/�4�1�~Zv���I�1�Sw�Ѹ� v��q�Sw�Ѹ� v���SW���i�>�+�E7q����i�.:�n���7��p��b� �}Ej���Z�G�6�u:��X���i�����FK�W5�i�w�&���Aw��j��{�>��Ś�[�/,�#��MB�v���q��(��U�SV��f���E7q����j�cq�Sw�Ѹ� v�����ֶ��Z�i� a]N�ZcP�Ⱌ�8�n?ݨq��%sJu�Ro�ɫ��q$�I�=��?ݣq��]��:�n���7��p�,SI��v��FS�*��6��+�����Y���i��㊙(�ti���$ѭ� 	.�� A+�����G�$��������e�?ݣq��.Hv�>�W����)<C�L�_P�u=A���u��X�O���?ݣq��RQ[#9T��&��)���h��N�w%����s$�.?��W� �%տ�%u� ��k%X�?-;q��G,^���hɣS�][��W_���Ə�Iuo�	]��� ���F���9!��4��_�{5?�%տ�%u� ��j����r�'���g95���7��J+dD�Njғc�j�n�w-������P��MF;~�JZ5�0�*rS��]QSկ5��=�̗3㑲j�7q����i�%d)M͹Iݱ�gO�����=�Ėҏ㍈5Sq����hvj�#7�f_����jo6��[�?�+T[�M�����i�hV��	Ԕ۔����H#�Ej���X��[9�+�-�H�BEc���]�������*gM5	5}��u����n?ݪ���P7q����h�\��?`_�W?e� �^a�e��ݏ-;q��DTc{#I՝O�M۸�)���h��Ws;����� v����\.:���.���i'x�bl��n���7�Ӹ�:�n���7��p��)���h��E��xӪ0�q�iۏ�i&$�QM��F���w�QM��F���.M��Ѹ� v��v��}B�Sw�Ѹ� v��㨦�?ݣq������4n?ݤf;O\.8t��c����?ݢ�q�Sw�Ѹ� v���QM��F���.�>�����;q��+�㨦�?ݣq��;�㨦�?ݣq������(��M$�P�6IE7q����h�\u����Qp��(��(����i�����K�����)�(�� )��M:�� t�����t� QE QE ��>��k�Zu!QLaEPM?|S���LLuQLaEPEPW�u5~�RBAESQE SW�:��)uQ�QE1�Q@#}�KH�t� �tR�/��	lQE
(�������N�.�ESQE S�>��}i11�QE1�Q@Q@_�i���ƝI	QLaEPM��ө���]E�uQLaEPH�t��7�4 /����E-[Q@(��ju5�S��QE�QE �� X)��� X)11�QE1�Q@Q@_�i���ƝIl$QE1�Q@6?�N���iuQ�QE1�Q@5��S_� Q�R����
(��
(���֝M~��N� ��)�(�� )��u4��I����)�(�� (�� (�� )���ƟL���4����(��(��� tө��M (�)iAK@Q@Q@~��N��A��RQE�QE ���:�~����QE�QE QE 5~�SW�u$$QE1�Q@5zS��җQuESQE R7�4���M �E-"��K@��EP0��(�ڝM~��B�QE1�Q@1�����֓ESQE QE ��ƝM_�iԐ�QE�QE ���:�ݥ�]GQE�QE ��M-#}�@��KH�tR�%�QE(�� k��S_�:���QLaEPLo���Lo���ESQE QE ��ƝM_�iԖ�AESQE Sc���lv�QuESQE S_�u5��- �)h ��( ��(��}i���>��B
(��(��~��SO����(��(��(��(����i�����K�����)�(�� )��M:�� t�����t� QE QE ��>��k�Zu!QLaEPM?|S���LLuQLaEPEPW�u5~�RBAESQE SW�:��)uQ�QE1�Q@#}�KH�t� �tR�/��	lQE
(�������N�.�ESQE S�>��}i11�QE1�Q@Q@_�i���ƝI	QLaEPM��ө���]E�uQLaEPH�t��7�4 /����E-[Q@(��ju5�S��QE�QE �� X)��� X)11�QE1�Q@Q@_�i���ƝIl$QE1�Q@6?�N���iuQ�QE1�Q@5��S_� Q�R����
(��
(���֝M~��N� ��)�(�� )��u4��I����)�(�� n�Q���)XV��a�E:�,���ݎ�)���Ƌj+j.�Q���(��7�(�z�uX,7�)6�ȧ�_�,��R�E(�)h�Xn�Q���(�Xn�Q���(�X��q�:Ӱޢ��>��,+�z�0ޢ�E��EoQN����E4��9%4��C@�a�EoQN����EoQN����EoQN�����ǑN�z��u$$��EoQN���a�oQF�S���a�oQM]��RSW�+j�0ޢ�7��QN�a�oQF�S���a�oQH��y�F�����lE.�R���X��a�E:�,��a�E:�,#`�r)�oQC��QaXn�Q���(��7�(�z�uX,7�)�v�Ҥ�7�Z��z�0ޢ�E�z�0ޢ�E�z�0ޢ�E�ۏ"���/�4�HI�z�0ޢ�E;�pޢ�7��QE��pޢ����%6?�Jڅ��(�z�u���a�E:�,����O�o�h�Xj���R�E*��KE�!�oQF�S���a�oQF�S���b7��"���?ju��EoQN���pޢ�7��QE��pޢ�wo�Ԕ�� X(hM��a�E:�,;�z�0ޢ�E�z�0ޢ�E�ۏ"���/�4�I	!�oQF�S��a�n�Q���(�Xn�SSv:���ݢڅ��(�z�uX,7�(�z�uX,7�)6�ȧ�_�,��R�E(�)h�Xn�Q���(�Xn�Q���(�X��`r:Ӱޢ��>��,��a�E:�,��a�E:�,��ӻx�T����A��a�E:�,��S���`��)�(�� )���ƟL���4����(��(��� tө��M (�)iAK@Q@Q@~��N��A��RQE�QE ���:�~����QE�QE QE 5~�SW�u$$QE1�Q@5zS��җQuESQE R7�4���M �E-"��K@��EP0��(�ڝM~��B�QE1�Q@1�����֓ESQE QE ��ƝM_�iԐ�QE�QE ���:�ݥ�]GQE�QE ��M-#}�@��KH�tR�%�QE(�� k��S_�:���QLaEPLo���Lo���ESQE QE ��ƝM_�iԖ�AESQE Sc���lv�QuESQE S_�u5��- �)h ��( ��(��}i���>��B
(��(��~��SO����(��(��(��(����i�����K�����)�(�� )��M:�� t�����t� QE QE ��>��k�Zu!QLaEPM?|S���LLuQLaEPEPW�u5~�RBAESQE SW�:��)uQ�QE1�Q@#}�KH�t� �tR�/��	lQE
(�������N�.�ESQE S�>��}i11�QE1�Q@Q@_�i���ƝI	QLaEPM��ө���]E�uQLaEPH�t��7�4 /����E-[Q@(��ju5�S��QE�QE �� X)��� X)11�QE1�Q@Q@_�i���ƝIl$QE1�Q@6?�N���iuQ�QE1�Q@5��S_� Q�R����
(��
(���֝M~��N� ��)�(�� )��u4��I����)�(�� (���4l�4���)�=�=���dw���i��OZ:�[�QM��h��h�����4l�4����M=�#/�y4��AKL	�����4�����4l�4�����4l�4��֝Q��OZv�s@�E7g��g��z�����ѳ������(��i�~qɡ�ܒ�n�sF�s@�E7g��g��5E7g��g��5�ƝQ���&����BC����4l�4Ǩ�)�=�=���j��g���q���-I(���4l�4Ǩ�)�=�=���F���g��d��hG/���N&�g���)�=�=���)�=�=��?juF�ӓN��h�)�=�=��uݞ捞��u1�����4Ҹqɡ�ܒ�n�sF�s@�E7g��g��5E7g��g��5�ƝQ���&����BC����4l�4Ǩ�)�=�=���lv��暋����-I(���4l�4Ǩ�)�=�=���F���g��d��hG/���N&�g���)�=�=���)�=�=��?juF�ӓN��h�)�=�=��uݞ捞��u1��
]��W����(���4l�4Q�Sv{�6{�Q�Sv{�6{�P_�i�_��i�=�$$:�n�sF�sLz�����ѳ������h��i��ME�%ݞ捞��:�n�sF�s@j:�� tѳ��2���CG����ɥ��hGQM��h��hGQM��h��hA��:�u�rzӶ{���)�=�=��uݞ捞��u4��F�sM+�MN�Sv{�6{���)�=�����c
(��
dw��#���.��>�(�0��( ���4�k��@
:
ZA�R�EPEP_��ө��}iԄQE1�Q@4��N���)11�QE1�Q@Q@_�i���ƝI	QLaEPM^��j���]GQE�QE ��M-#}�@��KH�tR�%�QE(�� k��S_�:���QLaEPLo���c}�����E�QE QE 5~�SW�u$$QE1�Q@6?�N���iuQ�QE1�Q@#}�KH�t� �tR�/��	lQE
(�������N�.�ESQE S�`���`����E�QE QE 5~�SW�u%��QE�QE ���:�ݥ�]GQE�QE ����M�hGAKH:
Z (�� (�� k�Zu5��:���(�0��( ���)����&&:�(�0��( ��( ��( �G�}2?����.�袊c
(��
k��N���4 ����- QE QE 5��:��֝HAESQE SO��i��ESQE QE ��ƝM_�iԐ�QE�QE ��N��J]E�uQLaEPH�t��7�4 /����E-[Q@(��ju5�S��QE�QE ���O�7�ZLL}QLaEPEPW�u5~�RBAESQE Sc���lv�QuESQE R7�4���M �E-"��K@��EP0��(�ڝM~��B�QE1�Q@1��
}1��
LL}QLaEPEPW�u5~�R[	QLaEPM��ө���]E�uQLaEPM�i�����t������(��(��A��S_��ө(��c
(��
i��M?|Rbc���c
(��
)2=E���L�QFG���G�vG���F޽�uQ�Rdz�2=E1�E&G��#�P�_�\�QH�m<������09��� �Rdz�2=E1�E&G��#�P?A��S�{Ӳ=E!E&G��#�S�Rdz�2=E -4��K��)���LL}����QLb�I��(�� �Rdz�2=E "��N�7i���%E&G��#�S(Z)2=E����)r=E"����Q��#�Q��)�Z)2=E�����#�R1O"��_�)i�F��.G���Rdz�2=E1�E&G��#�P?ju1��vG��!h���dz�c�L�QFG���7�ZvG����4���)2=E��Ţ�#�Q��(h���dz� E�ƝLn<Ӳ=EJ%E&G��#�U-����Q@M����z�j��.��>�L�QFG��1h���dz� ZF����QH�m<�B~襦�G4���B�I��(���-����Q@����#�i������#�Q��)�Z)2=E�����;#�S	�4��%����QLb�I��(�� �Rdz�2=E "��N�7i���%E&G��#�S(Z)2=E���ݥ���#oZ]E�}����QLb�I��(�� �����#�R9O4�(�)i��ir=E -����QLb�I��(�� ��}i��#���QHB�I��(���-����Q@M?|R�z�i#x�E&G��#�S�Rdz�(6/��b�
u���v/��b�
uY��_AMEtjJdw����.��l_AN��!�n��l_AN�� �݋�)F��>�� t�d+ A���R���� �݋�(ؾ��EC�݋�(ؾ��EAb7P �;b�
��Ө���_AF���(���_AF���(�ؾ����8��O�4��l_AF���(���_AF���(�ؾ����)�Qdn<R�_AB��N��%ؾ����)�S�*�v/��b�
uY��_AH�1ҟM^�����l_AF���)��v/��b�
uY��_AH�6�)��MB��A�qK�}*��KE�!��Q�}:�,�a��Q�}:�,��GR�_AC��Qd.�v/��b�
uY�v/��b�
uY��_AM*7�*Jc}���&�ؾ����)�Qd;ؾ����)�Qd�}�S���,Fn<S�/��~�RH�7b�
6/��QNȫؾ����)�Qd�}5�RSc����+j�Q�}:�vC�݋�(ؾ��EAa��R2��}#}�E��5PmR�_AJ�tR�dn��l_AN��!�n��l_AN�� ��Q���P���Y�݋�(ؾ��EC�݋�(ؾ��EAa��SJ�㊒���!4.��l_AN��!�n��l_AN�� �݋�(ؾ��EAb0�q❱}��:�H�7b�
6/��QNȫؾ����)�Qd�}5m�RSc��Y\V��(ؾ��EC�݋�(ؾ��EAa��R2���}5���V ��6/��-@7b�
6/��QE��7b�
6/��QE�X��`qޝ�}�}i�Y
�v/��b�
uY�v/��b�
uY��_AHToS��Bh6/��b�
uY�v/���EA`��)�QE S#���>���iuQ�QE1�Q@5��S_� Q�R����
(��
(���֝M~��N� ��)�(�� )��u4��I����)�(�� (�� j��N���4�HH(��c
(��
j��SW�.��:�(�0��( �o�ii� �ZE����-��(�aEP_�:���ԅ�(��c
(��
c}����&&>�(�0��( ��(���:��xө! ��)�(�� )���u6?�K�����)�(�� )�ZF�������~襠K`��(QE ��N��ju!u
(��(����>���&&>�(�0��( ��(���:��xө-���(�0��( ���i����.��:�(�0��( ���4�k��@
:
ZA�R�EPEP_��ө��}iԄQE1�Q@4��N���)11�QE1�Q@Q@Q@2?���E.��>�(�0��( ���4Q@
:
Z(��(��(��A��QE!QLaEPM?|QE&&:�(�0��( ��(���:�)! ��)�(�� )�Ҋ)uQ�QE1�Q@#}�E /��Q@��EP0��(�ڝE��(��c
(��
c}���LL}QLaEPEPW�uRBAESQE Sc��QK�����)�(�� )�(�~襢��
(���Q@~��(�.�ESQE S�`��LL}QLaEPEPW�uR[	QLaEPM���E.��:�(�0��( ���4Q@
:
Z(��(��(��A��QE!QLaEPM?|QE&&:�(�0��(��
```

## CyberX-frontend/public/vite.svg

```svg
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" class="iconify iconify--logos" width="31.88" height="32" preserveAspectRatio="xMidYMid meet" viewBox="0 0 256 257"><defs><linearGradient id="IconifyId1813088fe1fbc01fb466" x1="-.828%" x2="57.636%" y1="7.652%" y2="78.411%"><stop offset="0%" stop-color="#41D1FF"></stop><stop offset="100%" stop-color="#BD34FE"></stop></linearGradient><linearGradient id="IconifyId1813088fe1fbc01fb467" x1="43.376%" x2="50.316%" y1="2.242%" y2="89.03%"><stop offset="0%" stop-color="#FFEA83"></stop><stop offset="8.333%" stop-color="#FFDD35"></stop><stop offset="100%" stop-color="#FFA800"></stop></linearGradient></defs><path fill="url(#IconifyId1813088fe1fbc01fb466)" d="M255.153 37.938L134.897 252.976c-2.483 4.44-8.862 4.466-11.382.048L.875 37.958c-2.746-4.814 1.371-10.646 6.827-9.67l120.385 21.517a6.537 6.537 0 0 0 2.322-.004l117.867-21.483c5.438-.991 9.574 4.796 6.877 9.62Z"></path><path fill="url(#IconifyId1813088fe1fbc01fb467)" d="M185.432.063L96.44 17.501a3.268 3.268 0 0 0-2.634 3.014l-5.474 92.456a3.268 3.268 0 0 0 3.997 3.378l24.777-5.718c2.318-.535 4.413 1.507 3.936 3.838l-7.361 36.047c-.495 2.426 1.782 4.5 4.151 3.78l15.304-4.649c2.372-.72 4.652 1.36 4.15 3.788l-11.698 56.621c-.732 3.542 3.979 5.473 5.943 2.437l1.313-2.028l72.516-144.72c1.215-2.423-.88-5.186-3.54-4.672l-25.505 4.922c-2.396.462-4.435-1.77-3.759-4.114l16.646-57.705c.677-2.35-1.37-4.583-3.769-4.113Z"></path></svg>
```

## CyberX-frontend/src/assets/react.svg

```svg
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" aria-hidden="true" role="img" class="iconify iconify--logos" width="35.93" height="32" preserveAspectRatio="xMidYMid meet" viewBox="0 0 256 228"><path fill="#00D8FF" d="M210.483 73.824a171.49 171.49 0 0 0-8.24-2.597c.465-1.9.893-3.777 1.273-5.621c6.238-30.281 2.16-54.676-11.769-62.708c-13.355-7.7-35.196.329-57.254 19.526a171.23 171.23 0 0 0-6.375 5.848a155.866 155.866 0 0 0-4.241-3.917C100.759 3.829 77.587-4.822 63.673 3.233C50.33 10.957 46.379 33.89 51.995 62.588a170.974 170.974 0 0 0 1.892 8.48c-3.28.932-6.445 1.924-9.474 2.98C17.309 83.498 0 98.307 0 113.668c0 15.865 18.582 31.778 46.812 41.427a145.52 145.52 0 0 0 6.921 2.165a167.467 167.467 0 0 0-2.01 9.138c-5.354 28.2-1.173 50.591 12.134 58.266c13.744 7.926 36.812-.22 59.273-19.855a145.567 145.567 0 0 0 5.342-4.923a168.064 168.064 0 0 0 6.92 6.314c21.758 18.722 43.246 26.282 56.54 18.586c13.731-7.949 18.194-32.003 12.4-61.268a145.016 145.016 0 0 0-1.535-6.842c1.62-.48 3.21-.974 4.76-1.488c29.348-9.723 48.443-25.443 48.443-41.52c0-15.417-17.868-30.326-45.517-39.844Zm-6.365 70.984c-1.4.463-2.836.91-4.3 1.345c-3.24-10.257-7.612-21.163-12.963-32.432c5.106-11 9.31-21.767 12.459-31.957c2.619.758 5.16 1.557 7.61 2.4c23.69 8.156 38.14 20.213 38.14 29.504c0 9.896-15.606 22.743-40.946 31.14Zm-10.514 20.834c2.562 12.94 2.927 24.64 1.23 33.787c-1.524 8.219-4.59 13.698-8.382 15.893c-8.067 4.67-25.32-1.4-43.927-17.412a156.726 156.726 0 0 1-6.437-5.87c7.214-7.889 14.423-17.06 21.459-27.246c12.376-1.098 24.068-2.894 34.671-5.345a134.17 134.17 0 0 1 1.386 6.193ZM87.276 214.515c-7.882 2.783-14.16 2.863-17.955.675c-8.075-4.657-11.432-22.636-6.853-46.752a156.923 156.923 0 0 1 1.869-8.499c10.486 2.32 22.093 3.988 34.498 4.994c7.084 9.967 14.501 19.128 21.976 27.15a134.668 134.668 0 0 1-4.877 4.492c-9.933 8.682-19.886 14.842-28.658 17.94ZM50.35 144.747c-12.483-4.267-22.792-9.812-29.858-15.863c-6.35-5.437-9.555-10.836-9.555-15.216c0-9.322 13.897-21.212 37.076-29.293c2.813-.98 5.757-1.905 8.812-2.773c3.204 10.42 7.406 21.315 12.477 32.332c-5.137 11.18-9.399 22.249-12.634 32.792a134.718 134.718 0 0 1-6.318-1.979Zm12.378-84.26c-4.811-24.587-1.616-43.134 6.425-47.789c8.564-4.958 27.502 2.111 47.463 19.835a144.318 144.318 0 0 1 3.841 3.545c-7.438 7.987-14.787 17.08-21.808 26.988c-12.04 1.116-23.565 2.908-34.161 5.309a160.342 160.342 0 0 1-1.76-7.887Zm110.427 27.268a347.8 347.8 0 0 0-7.785-12.803c8.168 1.033 15.994 2.404 23.343 4.08c-2.206 7.072-4.956 14.465-8.193 22.045a381.151 381.151 0 0 0-7.365-13.322Zm-45.032-43.861c5.044 5.465 10.096 11.566 15.065 18.186a322.04 322.04 0 0 0-30.257-.006c4.974-6.559 10.069-12.652 15.192-18.18ZM82.802 87.83a323.167 323.167 0 0 0-7.227 13.238c-3.184-7.553-5.909-14.98-8.134-22.152c7.304-1.634 15.093-2.97 23.209-3.984a321.524 321.524 0 0 0-7.848 12.897Zm8.081 65.352c-8.385-.936-16.291-2.203-23.593-3.793c2.26-7.3 5.045-14.885 8.298-22.6a321.187 321.187 0 0 0 7.257 13.246c2.594 4.48 5.28 8.868 8.038 13.147Zm37.542 31.03c-5.184-5.592-10.354-11.779-15.403-18.433c4.902.192 9.899.29 14.978.29c5.218 0 10.376-.117 15.453-.343c-4.985 6.774-10.018 12.97-15.028 18.486Zm52.198-57.817c3.422 7.8 6.306 15.345 8.596 22.52c-7.422 1.694-15.436 3.058-23.88 4.071a382.417 382.417 0 0 0 7.859-13.026a347.403 347.403 0 0 0 7.425-13.565Zm-16.898 8.101a358.557 358.557 0 0 1-12.281 19.815a329.4 329.4 0 0 1-23.444.823c-7.967 0-15.716-.248-23.178-.732a310.202 310.202 0 0 1-12.513-19.846h.001a307.41 307.41 0 0 1-10.923-20.627a310.278 310.278 0 0 1 10.89-20.637l-.001.001a307.318 307.318 0 0 1 12.413-19.761c7.613-.576 15.42-.876 23.31-.876H128c7.926 0 15.743.303 23.354.883a329.357 329.357 0 0 1 12.335 19.695a358.489 358.489 0 0 1 11.036 20.54a329.472 329.472 0 0 1-11 20.722Zm22.56-122.124c8.572 4.944 11.906 24.881 6.52 51.026c-.344 1.668-.73 3.367-1.15 5.09c-10.622-2.452-22.155-4.275-34.23-5.408c-7.034-10.017-14.323-19.124-21.64-27.008a160.789 160.789 0 0 1 5.888-5.4c18.9-16.447 36.564-22.941 44.612-18.3ZM128 90.808c12.625 0 22.86 10.235 22.86 22.86s-10.235 22.86-22.86 22.86s-22.86-10.235-22.86-22.86s10.235-22.86 22.86-22.86Z"></path></svg>
```

## CyberX-frontend/src/components/layout/Layout.tsx

```tsx
// src/components/layout/Layout.tsx
import React, { useState } from 'react';
import type { PropsWithChildren } from 'react';
import { Link } from 'react-router-dom';
import WebGLBackground from '../WebGLBackground';
import { Menu, MenuItem, HoveredLink, ProductItem } from '../ui/navbar-menu';

const Layout: React.FC<PropsWithChildren> = ({ children }) => {
  const [active, setActive] = useState<string | null>(null);

  return (
    <div className="relative min-h-screen text-white isolate">
      {/* Animated background behind everything */}
      <WebGLBackground />

      {/* Optional subtle contrast over the animation */}
      <div className="fixed inset-0 -z-[1] pointer-events-none bg-gradient-to-b from-black/30 via-black/10 to-black/40" />

      {/* Navbar (fixed, centered, above background) */}
      <Menu setActive={setActive}>
        {/* Home */}
        <MenuItem setActive={setActive} active={active} item="Home">
          <div className="grid grid-cols-1 gap-2">
            <Link className="hover:text-cyan-400" to="/">Overview</Link>
            <Link className="hover:text-cyan-400" to="/visualizer">Attack Visualizer</Link>
            <Link className="hover:text-cyan-400" to="/reports">Threat Reports</Link>
          </div>
        </MenuItem>

        {/* Honeypot & Defense */}
        <MenuItem setActive={setActive} active={active} item="Honeypot">
          <div className="grid grid-cols-1 gap-2">
            <Link className="hover:text-cyan-400" to="/honeypot">Honeypot Dashboard</Link>
            <Link className="hover:text-cyan-400" to="/honeypot/ssh">SSH Honeypot</Link>
            <Link className="hover:text-cyan-400" to="/honeypot/http">HTTP Honeypot</Link>
            <Link className="hover:text-cyan-400" to="/honeypot/db">Database Honeypot</Link>
            <Link className="hover:text-cyan-400" to="/ids">IDS</Link>
            <Link className="hover:text-cyan-400" to="/siem">Log Monitoring & SIEM</Link>
          </div>
        </MenuItem>

        {/* Tools: Recon & Exploitation */}
        <MenuItem setActive={setActive} active={active} item="Tools">
          <div className="grid grid-cols-2 gap-3">
            <Link className="hover:text-cyan-400" to="/tools/port-scanner">Port Scanner</Link>
            <Link className="hover:text-cyan-400" to="/tools/service-detect">Service Detection</Link>
            <Link className="hover:text-cyan-400" to="/tools/os-fingerprint">OS Fingerprint</Link>
            <Link className="hover:text-cyan-400" to="/tools/subdomains">Subdomain Enum</Link>
            <Link className="hover:text-cyan-400" to="/tools/whois">WHOIS Lookup</Link>
            <Link className="hover:text-cyan-400" to="/tools/dns-recon">DNS Recon</Link>
            <Link className="hover:text-cyan-400" to="/tools/reverse-ip">Reverse IP</Link>
            <Link className="hover:text-cyan-400" to="/tools/ip-geo">IP Geolocation</Link>
            <Link className="hover:text-cyan-400" to="/tools/dir-fuzzer">Dir & File Fuzzer</Link>
            <Link className="hover:text-cyan-400" to="/tools/vuln-fuzzer">Vulnerability Fuzzer</Link>
            <Link className="hover:text-cyan-400" to="/tools/api-scanner">API Scanner</Link>
            <Link className="hover:text-cyan-400" to="/tools/broken-auth">Broken Auth Detector</Link>
          </div>
        </MenuItem>

        {/* Cloud & Containers */}
        <MenuItem setActive={setActive} active={active} item="Cloud">
          <div className="grid grid-cols-1 gap-2">
            <Link className="hover:text-cyan-400" to="/tools/s3-finder">S3 Bucket Finder</Link>
            <Link className="hover:text-cyan-400" to="/tools/container-scan">Container CVE Scanner</Link>
            <Link className="hover:text-cyan-400" to="/tools/k8s-enum">Kubernetes Enum</Link>
          </div>
        </MenuItem>

        {/* Crypto & Hashing */}
        <MenuItem setActive={setActive} active={active} item="Crypto">
          <div className="grid grid-cols-1 gap-2">
            <Link className="hover:text-cyan-400" to="/tools/hash-cracker">Hash Gen/Cracker</Link>
            <Link className="hover:text-cyan-400" to="/tools/ciphers">Cipher Tools</Link>
            <Link className="hover:text-cyan-400" to="/tools/rsa-aes">RSA/AES Encrypt/Decrypt</Link>
            <Link className="hover:text-cyan-400" to="/tools/jwt">JWT Decoder</Link>
          </div>
        </MenuItem>

        {/* Stego & Media */}
        <MenuItem setActive={setActive} active={active} item="Stego">
          <div className="grid grid-cols-1 gap-2">
            <Link className="hover:text-cyan-400" to="/tools/stego-image">Image Steganography</Link>
            <Link className="hover:text-cyan-400" to="/tools/stego-audio">Audio Steganography</Link>
            <Link className="hover:text-cyan-400" to="/tools/stego-extract">Stego Extractor</Link>
            <Link className="hover:text-cyan-400" to="/tools/image-exif">Image EXIF Analyzer</Link>
          </div>
        </MenuItem>

        {/* OSINT & Intelligence */}
        <MenuItem setActive={setActive} active={active} item="OSINT">
          <div className="grid grid-cols-1 gap-2">
            <Link className="hover:text-cyan-400" to="/tools/breach-check">Email Breach Checker</Link>
            <Link className="hover:text-cyan-400" to="/tools/google-dorks">Google Dorking</Link>
            <Link className="hover:text-cyan-400" to="/tools/shodan-censys">Shodan & Censys</Link>
            <Link className="hover:text-cyan-400" to="/tools/pastebin-leaks">Pastebin Leaks</Link>
            <Link className="hover:text-cyan-400" to="/intel">Threat Intelligence</Link>
          </div>
        </MenuItem>

        {/* AI & Simulations */}
        <MenuItem setActive={setActive} active={active} item="AI Engine">
          <div className="grid grid-cols-1 gap-2">
            <Link className="hover:text-cyan-400" to="/ai/engine">Adaptive Engine</Link>
            <Link className="hover:text-cyan-400" to="/ai/phishing">AI Phishing Detector</Link>
            <Link className="hover:text-cyan-400" to="/ai/malware">AI Malware Classifier</Link>
            <Link className="hover:text-cyan-400" to="/sim/rt-vs-bt">Red vs Blue Simulator</Link>
          </div>
        </MenuItem>

        {/* About */}
        <MenuItem setActive={setActive} active={active} item="About">
          <div className="grid grid-cols-1 gap-2">
            <Link className="hover:text-cyan-400" to="/about">Project</Link>
            <Link className="hover:text-cyan-400" to="/reports">Weekly Reports</Link>
          </div>
        </MenuItem>
      </Menu>

      {/* Content area (above overlay/background; below navbar) */}
      <main className="relative z-20 pt-20 px-4">
        {children}
      </main>
    </div>
  );
};

export default Layout;
```

## CyberX-frontend/src/components/ui/navbar-menu.tsx

```tsx
import React from 'react';
import { motion } from 'motion/react';
import { spring } from 'motion'; // generator, not the string "spring"

const transition = {
  type: spring,
  stiffness: 100,
  damping: 11.5,
  mass: 0.5,
  restDelta: 0.001,
  restSpeed: 0.001,
};

export const MenuItem = ({
  setActive,
  active,
  item,
  children,
}: {
  setActive: (item: string | null) => void;   // allow closing to null
  active: string | null;
  item: string;
  children?: React.ReactNode;
}) => {
  return (
    <div
      onMouseEnter={() => setActive(item)}
      className="relative inline-flex flex-col items-center"
    >
      <motion.p transition={{ duration: 0.3 }}
        className="cursor-pointer text-white hover:text-cyan-400 font-medium">
        {item}
      </motion.p>

      {active === item && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={transition}
          className="absolute top-full mt-3 left-1/2 -translate-x-1/2 z-50 pointer-events-auto"
          onMouseLeave={() => setActive(null)}   // close when leaving the popover
        >
          <motion.div
            layoutId={`popover-${item}`} // unique per item avoids cross-item FLIP jumps
            className="min-w-56 max-w-[720px] max-h-[70vh] overflow-auto
                       bg-black/70 backdrop-blur-xl rounded-2xl
                       border border-white/20 shadow-xl"
            style={{ overflow: "hidden" }}
          >
            <motion.div layout className="w-max p-4"> {/* note: no h-full */}
              {children}
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
};

export const Menu = ({
  setActive,
  children,
}: {
  setActive: (item: string | null) => void;
  children: React.ReactNode;
}) => {
  return (
    <nav
      onMouseLeave={() => setActive(null)}
      className="fixed top-0 left-0 right-0 z-40 flex items-center justify-center
                 gap-10 px-8 py-4 bg-black/40 backdrop-blur-lg
                 border-b border-white/10 shadow-lg"
    >
      <div className="flex items-center justify-center gap-8">
        {children}
      </div>
    </nav>
  );
};

export const ProductItem = ({
  title, description, href, src,
}: { title: string; description: string; href: string; src: string; }) => (
  <a href={href} className="flex space-x-2">
    <img src={src} width={140} height={70} alt={title} className="shrink-0 rounded-md shadow-2xl" />
    <div>
      <h4 className="text-xl font-bold mb-1 text-white">{title}</h4>
      <p className="text-neutral-300 text-sm max-w-[10rem]">{description}</p>
    </div>
  </a>
);

export const HoveredLink = (
  props: React.AnchorHTMLAttributes<HTMLAnchorElement>
) => {
  const { children, className = '', ...rest } = props;
  return (
    <a {...rest} className={`text-neutral-200 hover:text-white ${className}`}>
      {children}
    </a>
  );
};
```

## CyberX-frontend/src/components/CyberpunkCard.tsx

```tsx
import React from "react";

export type CyberpunkCardProps = {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  // Optional theming overrides
  red?: string;        // primary neon red
  deepRed?: string;    // deeper red
  panelAlpha?: number; // 0..1 transparency for the card panel
  showBackground?: boolean; // render the red gradient screen
  width?: number;      // max width in px
};

export default function CyberpunkCard({
  title = "Error",
  message = "User settings data appear to be corrupted and cannot be loaded. They will be replaced with default settings data.",
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  red = "#ff2b45",
  deepRed = "#d50f2f",
  panelAlpha = 0.6,
  showBackground = true,
  width = 720,
}: CyberpunkCardProps) {
  const css = `
  .cp-root{ --cp-red:${red}; --cp-red-2:${deepRed}; --cp-dark:#0b0002; --cp-bg-1:#2a0006; --cp-bg-2:#0a0001; --cp-panel: rgb(10 0 2 / ${panelAlpha}); --cp-cyan:#6de8ff; --cp-amber:#ffb300; --cp-radius:12px; --cp-border:1px; --cp-glow: 0 0 .75rem rgb(255 43 69 / .55), 0 0 2.25rem rgb(255 43 69 / .35); --cp-soft-shadow: 0 10px 30px rgb(0 0 0 / .6); }
  .cp-screen{ min-height:100dvh; display:grid; place-items:center; padding:24px; background-image: linear-gradient(160deg, var(--cp-bg-1) 0%, var(--cp-bg-2) 70%); color:#f6e9ea; }
  .cp-card{ position:relative; width:min(${width}px, 92vw); padding:20px 20px 16px; border-radius:var(--cp-radius); background:var(--cp-panel); border:var(--cp-border) solid var(--cp-red); box-shadow: var(--cp-soft-shadow), var(--cp-glow); -webkit-backdrop-filter: blur(8px) saturate(120%); backdrop-filter: blur(8px) saturate(120%); overflow:hidden; }
  .cp-card::before{ content:""; position:absolute; inset:0 0 auto 0; height:3px; background: linear-gradient(90deg, transparent, var(--cp-red), var(--cp-red-2), transparent); opacity:.9; pointer-events:none; }
  .cp-card::after{ content:""; position:absolute; inset:0; background: linear-gradient(180deg, rgb(255 255 255 / .04), transparent 15% 85%, rgb(255 255 255 / .03)); mix-blend-mode: screen; pointer-events:none; }
  .cp-header{ display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
  .cp-title{ margin:0; font-size:1.1rem; letter-spacing:.06em; text-transform:uppercase; color:#ffd6dc; text-shadow: 0 0 6px rgb(255 43 69 / .45), 0 0 16px rgb(255 43 69 / .25); animation: cp-flicker 5s linear infinite; }
  @keyframes cp-flicker{ 0%,100%{opacity:.95;} 45%{opacity:.80;} 47%{opacity:.98;} 50%{opacity:.70;} 55%{opacity:.96;} }
  @media (prefers-reduced-motion: reduce){ .cp-title{ animation:none; } }
  .cp-chip{ display:inline-flex; align-items:center; gap:.4ch; border:1px solid currentColor; padding:.25rem .5rem; border-radius:8px; font-size:.8rem; letter-spacing:.04em; color:var(--cp-amber); }
  .cp-text{ margin:8px 0 16px; opacity:.9; line-height:1.4; }
  .cp-actions{ display:flex; gap:10px; }
  .cp-btn{ background: color-mix(in srgb, var(--cp-red) 12%, transparent); color:#ffe7eb; border:1px solid var(--cp-red); padding:.6rem 1rem; border-radius:10px; letter-spacing:.04em; cursor:pointer; box-shadow: 0 0 0 1px rgb(255 43 69 / .25) inset, var(--cp-glow); transition: transform .08s ease, box-shadow .2s ease, background-color .2s ease; }
  .cp-btn:hover{ background: color-mix(in srgb, var(--cp-red) 22%, transparent); box-shadow: 0 0 0 1px rgb(255 43 69 / .35) inset, var(--cp-glow); transform: translateY(-1px); }
  .cp-btn:active{ transform: translateY(0); }
  .cp-btn--ghost{ background: transparent; color:#ffb6c0; box-shadow:none; border-color: color-mix(in srgb, var(--cp-red) 65%, transparent); }
  .cp-btn:focus-visible{ outline:none; box-shadow: 0 0 0 2px rgb(0 0 0 / .9), 0 0 0 4px color-mix(in srgb, var(--cp-red) 60%, #ffffff); }
  `;

  const Card = (
    <div className="cp-card">
      <div className="cp-header">
        <h3 className="cp-title">{title}</h3>
        <span className="cp-chip">OK</span>
      </div>
      <p className="cp-text">{message}</p>
      <div className="cp-actions">
        <button className="cp-btn" onClick={onConfirm}>{confirmText}</button>
        <button className="cp-btn cp-btn--ghost" onClick={onCancel}>{cancelText}</button>
      </div>
    </div>
  );

  return (
    <div className="cp-root">
      <style>{css}</style>
      {showBackground ? (
        <div className="cp-screen">{Card}</div>
      ) : (
        Card
      )}
    </div>
  );
}
```

## CyberX-frontend/src/components/WebGLBackground.tsx

```tsx
import React, { useRef, useEffect } from 'react';

interface WebGLBackgroundProps {
  className?: string;
}

const WebGLBackground: React.FC<WebGLBackgroundProps> = ({ className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  const vertexShaderSource = `
    attribute vec4 a_position;
    void main() {
      gl_Position = a_position;
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;
    #define TWO_PI 6.28318530718

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec2 u_colsrows;

    float HueToRGB(float f1, float f2, float hue) {
      if (hue < 0.0) hue += 1.0;
      else if (hue > 1.0) hue -= 1.0;
      float res;
      if ((6.0 * hue) < 1.0)
        res = f1 + (f2 - f1) * 6.0 * hue;
      else if ((2.0 * hue) < 1.0)
        res = f2;
      else if ((3.0 * hue) < 2.0)
        res = f1 + (f2 - f1) * ((2.0 / 3.0) - hue) * 6.0;
      else
        res = f1;
      return res;
    }

    vec3 HSLToRGB(vec3 hsl) {
      vec3 rgb;
      if (hsl.y == 0.0)
        rgb = vec3(hsl.z);
      else {
        float f2;
        if (hsl.z < 0.5)
          f2 = hsl.z * (1.0 + hsl.y);
        else
          f2 = (hsl.z + hsl.y) - (hsl.y * hsl.z);

        float f1 = 2.0 * hsl.z - f2;
        rgb.r = HueToRGB(f1, f2, hsl.x + (1.0/3.0));
        rgb.g = HueToRGB(f1, f2, hsl.x);
        rgb.b = HueToRGB(f1, f2, hsl.x - (1.0/3.0));
      }
      return rgb;
    }

    mat2 rotate2d(float angle) {
      return mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    }

    vec2 rotateFrom(vec2 uv, vec2 center, float angle) {
      vec2 uv_ = uv - center;
      uv_ = rotate2d(angle) * uv_;
      return uv_ + center;
    }

    float random(float value) {
      return fract(sin(value) * 43758.5453123);
    }

    float random(vec2 tex) {
      return fract(sin(dot(tex.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    vec2 random2D(vec2 uv) {
      uv = vec2(dot(uv, vec2(127.1, 311.7)), dot(uv, vec2(269.5, 183.3)));
      return fract(sin(uv) * 43758.5453123);
    }

    vec3 random3D(vec3 uv) {
      uv = vec3(
        dot(uv, vec3(127.1, 311.7, 120.9898)),
        dot(uv, vec3(269.5, 183.3, 150.457)),
        dot(uv, vec3(380.5, 182.3, 170.457))
      );
      return -1.0 + 2.0 * fract(sin(uv) * 43758.5453123);
    }

    float cubicCurve(float value) {
      return value * value * (3.0 - 2.0 * value);
    }

    vec2 cubicCurve(vec2 value) {
      return value * value * (3.0 - 2.0 * value);
    }

    // NEW: vec3 overload to replace missing cubicCurve3
    vec3 cubicCurve(vec3 value) {
      return value * value * (3.0 - 2.0 * value);
    }

    float noise(vec2 uv) {
      vec2 iuv = floor(uv);
      vec2 fuv = fract(uv);
      vec2 suv = cubicCurve(fuv);

      float dotAA = dot(random2D(iuv + vec2(0.0)), fuv - vec2(0.0));
      float dotBB = dot(random2D(iuv + vec2(1.0, 0.0)), fuv - vec2(1.0, 0.0));
      float dotCC = dot(random2D(iuv + vec2(0.0, 1.0)), fuv - vec2(0.0, 1.0));
      float dotDD = dot(random2D(iuv + vec2(1.0, 1.0)), fuv - vec2(1.0, 1.0));

      return mix(mix(dotAA, dotBB, suv.x), mix(dotCC, dotDD, suv.x), suv.y);
    }

    float noise(vec3 uv) {
      vec3 iuv = floor(uv);
      vec3 fuv = fract(uv);
      vec3 suv = cubicCurve(fuv); // replaced cubicCurve3

      float dotAA = dot(random3D(iuv + vec3(0.0)), fuv - vec3(0.0));
      float dotBB = dot(random3D(iuv + vec3(1.0, 0.0, 0.0)), fuv - vec3(1.0, 0.0, 0.0));
      float dotCC = dot(random3D(iuv + vec3(0.0, 1.0, 0.0)), fuv - vec3(0.0, 1.0, 0.0));
      float dotDD = dot(random3D(iuv + vec3(1.0, 1.0, 0.0)), fuv - vec3(1.0, 1.0, 0.0));

      float dotEE = dot(random3D(iuv + vec3(0.0, 0.0, 1.0)), fuv - vec3(0.0, 0.0, 1.0));
      float dotFF = dot(random3D(iuv + vec3(1.0, 0.0, 1.0)), fuv - vec3(1.0, 0.0, 1.0));
      float dotGG = dot(random3D(iuv + vec3(0.0, 1.0, 1.0)), fuv - vec3(0.0, 1.0, 1.0));
      float dotHH = dot(random3D(iuv + vec3(1.0, 1.0, 1.0)), fuv - vec3(1.0, 1.0, 1.0));

      float passH0 = mix(mix(dotAA, dotBB, suv.x), mix(dotCC, dotDD, suv.x), suv.y);
      float passH1 = mix(mix(dotEE, dotFF, suv.x), mix(dotGG, dotHH, suv.x), suv.y);

      return mix(passH0, passH1, suv.z);
    }

    float rect(vec2 uv, vec2 length, float smooth) {
      float dx = abs(uv.x - 0.5);
      float dy = abs(uv.y - 0.5);
      float lenx = 1.0 - smoothstep(length.x - smooth, length.x + smooth, dx);
      float leny = 1.0 - smoothstep(length.y - smooth, length.y + smooth, dy);
      return lenx * leny;
    }

    vec4 addGrain(vec2 uv, float time, float grainIntensity) {
      float grain = random(fract(uv * time)) * grainIntensity;
      return vec4(vec3(grain), 1.0);
    }

    vec2 fishey(vec2 uv, vec2 center, float ratio, float dist) {
      vec2 puv = uv + vec2(1.0);
      vec2 m = vec2(center.x, center.y/ratio) + vec2(1.0);
      vec2 d = puv - m;
      float r = sqrt(dot(d, d));
      float power = (TWO_PI / (2.0 * sqrt(dot(m, m)))) * mix(0.1, 0.4, pow(dist, 0.75));
      float bind;
      if (power > 0.0) bind = sqrt(dot(m, m));

      vec2 nuv;
      if (power > 0.0)
        nuv = m + normalize(d) * tan(r * power) * bind / tan(bind * power);
      else if (power < 0.0)
        nuv = m + normalize(d) * atan(r * -power * 10.0) * bind / atan(-power * bind * 10.0);
      else
        nuv = puv;

      return nuv - vec2(1.0);
    }

    float addStreamLine(vec2 uv, float rows, float height, float smooth) {
      vec2 uvstream = uv * vec2(1.0, rows);
      float distFromCenter = abs(0.5 - fract(uvstream.y));
      float edge = smoothstep(height - smooth*0.5, height + smooth*0.5, distFromCenter);
      return edge;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      vec2 ouv = uv;
      float ratio = u_resolution.x / u_resolution.y;

      float horizontalGlitch = sin(random(uv.y) * TWO_PI);
      float noiseAmp = noise(vec2(uv.y + u_time * horizontalGlitch));
      float minAmp = 0.001;
      float maxAmp = 0.005;
      float amp = mix(minAmp, maxAmp, noiseAmp);
      uv.x = fract(uv.x + amp);

      uv = fishey(uv, vec2(0.5, 0.5/ratio), 1.0, 2.0);
      uv = rotateFrom(uv, vec2(0.5, 0.5 * ratio), u_time * 0.01);

      float indexCol = floor(uv.x * (u_colsrows.x * 2.0)/ratio);
      float randColIndex = random(indexCol);
      float orientation = randColIndex * 2.0 - 1.0;
      float minSpeed = 0.1;
      float maxSpeed = 0.5;
      float speed = mix(minSpeed, maxSpeed, randColIndex);

      uv.y += u_time * speed * orientation;
      uv.y += floor(u_time);

      vec2 nuv = uv * vec2(u_colsrows.x, u_colsrows.x / ratio);
      vec2 fuv = fract(nuv);
      vec2 iuv = floor(nuv);

      float sub = 0.0;
      for (int i = 0; i < 4; i++) {
        float randRatio = random(iuv + floor(u_time));
        float noiseRatio = sin(noise(vec3(iuv * 0.05, u_time)) * (TWO_PI * 0.5)) * 0.5;
        if (randRatio + noiseRatio > 0.5) {
          nuv = fuv * vec2(3.0);
          fuv = fract(nuv);
          iuv += floor(nuv + float(i));
          sub += 1.0;
        }
      }

      float indexRatio = step(2.0, sub);
      float index = random(iuv);
      float isLight = step(0.5, index) * indexRatio;

      float randIndex = random(iuv * 0.01 + floor(u_time));
      float minSize = 0.05;
      float maxSize = 0.35;
      float size = mix(minSize, maxSize, randIndex);

      float shape = rect(fuv, vec2(size), 0.01) * isLight;

      // FIX: use noise(vec2 ...) instead of undefined noise2D(...)
      float shiftNoiseAnimation = noise(iuv * (u_time * 0.1)) * 0.25;
      float shiftRandomAnimation = random(vec2(u_time)) * 0.01;
      vec2 offset = vec2(shiftRandomAnimation + shiftNoiseAnimation, 0.0);
      float shapeRed = rect(fuv - offset, vec2(size), 0.01);
      float shapeGreen = rect(fuv + offset, vec2(size), 0.01);
      float shapeBlue = rect(fuv, vec2(size), 0.01);

      float minHue = 0.6;
      float maxHue = 1.0;
      float hue = mix(minHue, maxHue, randIndex);

      float randIndex2 = random(iuv * 0.5 + floor(u_time));
      float minLightness = 0.65;
      float maxLightness = 0.85;
      float lightness = mix(minLightness, maxLightness, randIndex2);

      vec3 background = HSLToRGB(vec3(336.0/360.0, 0.75, 0.075));
      vec3 foreground = HSLToRGB(vec3(hue, 1.0, lightness));

      vec3 shapeShift = vec3(shapeRed, shapeGreen, shapeBlue) * shape;
      vec3 final = mix(background, foreground, shapeShift);

      float randGrain = random(u_time * 0.001);
      vec4 grain = addGrain(uv, u_time, 0.05 + randGrain * 0.05);

      vec2 souv = fract(ouv + vec2(0.0, u_time * 0.05));
      float brightness = sin(souv.y * TWO_PI * 2.0);
      float vhsLines = addStreamLine(souv, 200.0, 0.35, 0.01) * brightness;

      gl_FragColor = vec4(final, 1.0) + vhsLines * 0.05 + grain;
    }
  `;

  const createShader = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  };

  const createProgram = (gl: WebGLRenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram | null => {
    const program = gl.createProgram();
    if (!program) return null;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }

    return program;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl');
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }

    // Create shaders
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertexShader || !fragmentShader) return;

    // Create program
    const program = createProgram(gl, vertexShader, fragmentShader);
    if (!program) return;

    // Set up geometry (full screen quad)
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
        -1,  1,
         1, -1,
         1,  1,
      ]),
      gl.STATIC_DRAW
    );

    // Get attribute and uniform locations
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    const timeLocation = gl.getUniformLocation(program, 'u_time');
    const colsRowsLocation = gl.getUniformLocation(program, 'u_colsrows');

    const startTime = Date.now();

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    resize();
    window.addEventListener('resize', resize);

    const render = () => {
      const currentTime = (Date.now() - startTime) / 1000;

      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);

      // Set up position attribute
      gl.enableVertexAttribArray(positionLocation);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      // Set uniforms
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, currentTime);
      gl.uniform2f(colsRowsLocation, 3.0, 2.0);

      // Draw
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationRef.current);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.deleteBuffer(positionBuffer);
    };
  }, []);

  return (
  <canvas
    ref={canvasRef}
    className={`fixed inset-0 z-0 pointer-events-none w-screen h-screen ${className}`}
  />
);

};

export default WebGLBackground;
```

## CyberX-frontend/src/data/navigation.ts

```ts
import type { NavItem } from '../types';

export const navigationItems: NavItem[] = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: '🎯',
    path: '/dashboard'
  },
  {
    id: 'honeypots',
    title: 'Honeypot Simulator',
    icon: '🍯',
    path: '/honeypots',
    children: [
      { id: 'ssh-honeypot', title: 'SSH Honeypot', icon: '🔑', path: '/honeypots/ssh' },
      { id: 'http-honeypot', title: 'HTTP Honeypot', icon: '🌐', path: '/honeypots/http' },
      { id: 'ftp-honeypot', title: 'FTP Honeypot', icon: '📁', path: '/honeypots/ftp' },
      { id: 'database-honeypot', title: 'Database Honeypot', icon: '🗄️', path: '/honeypots/database' }
    ]
  },
  {
    id: 'ai-engine',
    title: 'AI Engine',
    icon: '🧠',
    path: '/ai-engine',
    children: [
      { id: 'behavioral-analysis', title: 'Behavioral Analysis', icon: '📊', path: '/ai-engine/behavioral' },
      { id: 'anomaly-detection', title: 'Anomaly Detection', icon: '🚨', path: '/ai-engine/anomaly' },
      { id: 'threat-intelligence', title: 'Threat Intel', icon: '🔍', path: '/ai-engine/intel' }
    ]
  },
  {
    id: 'offensive-tools',
    title: 'Offensive Tools',
    icon: '⚔️',
    path: '/offensive-tools',
    children: [
      { id: 'reconnaissance', title: 'Reconnaissance', icon: '🔭', path: '/offensive-tools/recon' },
      { id: 'exploitation', title: 'Exploitation', icon: '💥', path: '/offensive-tools/exploit' },
      { id: 'malware-sim', title: 'Malware Simulator', icon: '🦠', path: '/offensive-tools/malware' }
    ]
  },
  {
    id: 'defensive-tools',
    title: 'Defensive Tools',
    icon: '🛡️',
    path: '/defensive-tools',
    children: [
      { id: 'ids', title: 'IDS', icon: '🚨', path: '/defensive-tools/ids' },
      { id: 'log-analysis', title: 'Log Analysis', icon: '📝', path: '/defensive-tools/logs' },
      { id: 'traffic-monitor', title: 'Traffic Monitor', icon: '📡', path: '/defensive-tools/traffic' }
    ]
  },
  {
    id: 'visualization',
    title: 'Visualization',
    icon: '📈',
    path: '/visualization',
    children: [
      { id: 'attack-map', title: 'Attack Map', icon: '🗺️', path: '/visualization/map' },
      { id: 'session-replay', title: 'Session Replay', icon: '▶️', path: '/visualization/replay' },
      { id: 'reports', title: 'Reports', icon: '📊', path: '/visualization/reports' }
    ]
  },
  {
    id: 'tools',
    title: 'Security Tools',
    icon: '🔧',
    path: '/tools',
    children: [
      { id: 'url-scanner', title: 'URL Scanner', icon: '🔗', path: '/tools/url-scanner' },
      { id: 'dns-resolver', title: 'DNS Resolver', icon: '🌐', path: '/tools/dns' },
      { id: 'jwt-inspector', title: 'JWT Inspector', icon: '🔑', path: '/tools/jwt' }
    ]
  },
  {
    id: 'simulations',
    title: 'Simulations',
    icon: '🎮',
    path: '/simulations',
    children: [
      { id: 'attack-lab', title: 'Attack Lab', icon: '🧪', path: '/simulations/attack-lab' },
      { id: 'defense-lab', title: 'Defense Lab', icon: '🔒', path: '/simulations/defense-lab' },
      { id: 'ctf-arena', title: 'CTF Arena', icon: '🏆', path: '/simulations/ctf' }
    ]
  },
  {
    id: 'deployment',
    title: 'Deployment',
    icon: '🚀',
    path: '/deployment'
  }
];
```

## CyberX-frontend/src/lib/utils.ts

```ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

## CyberX-frontend/src/pages/AIEngine.tsx

```tsx
import React from 'react';

const AIEngine: React.FC = () => {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-cyan-400">AI Engine - Adaptive Defense</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-purple-400 mb-4">🧠 Behavioral Analysis</h2>
          <p className="text-gray-300 text-sm mb-4">ML-powered clustering of attacker patterns</p>
          <div className="space-y-2">
            <div className="text-sm text-gray-400">Active Models: <span className="text-white">3</span></div>
            <div className="text-sm text-gray-400">Patterns Identified: <span className="text-white">127</span></div>
            <div className="text-sm text-gray-400">Accuracy: <span className="text-green-400">94.7%</span></div>
          </div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-red-400 mb-4">🚨 Anomaly Detection</h2>
          <p className="text-gray-300 text-sm mb-4">Real-time detection of suspicious behavior</p>
          <div className="space-y-2">
            <div className="text-sm text-gray-400">Anomalies Today: <span className="text-red-400">23</span></div>
            <div className="text-sm text-gray-400">False Positives: <span className="text-yellow-400">2.1%</span></div>
            <div className="text-sm text-gray-400">Response Time: <span className="text-green-400">1.2s</span></div>
          </div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-blue-400 mb-4">🔍 Threat Intelligence</h2>
          <p className="text-gray-300 text-sm mb-4">External threat feeds and correlation</p>
          <div className="space-y-2">
            <div className="text-sm text-gray-400">IOCs Tracked: <span className="text-white">15,432</span></div>
            <div className="text-sm text-gray-400">Feeds Active: <span className="text-green-400">8</span></div>
            <div className="text-sm text-gray-400">Last Update: <span className="text-white">2 min ago</span></div>
          </div>
        </div>
      </div>
      
      <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
        <h2 className="text-xl font-semibold text-cyan-400 mb-4">AI Model Training Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-gray-400">Command Classification Model</span>
                <span className="text-sm text-green-400">Training Complete</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div className="bg-green-400 h-2 rounded-full" style={{ width: '100%' }}></div>
              </div>
            </div>
            
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm text-gray-400">Behavioral Clustering Model</span>
                <span className="text-sm text-yellow-400">Training (73%)</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div className="bg-yellow-400 h-2 rounded-full" style={{ width: '73%' }}></div>
              </div>
            </div>
          </div>
          
          <div className="text-sm text-gray-300 space-y-2">
            <p><span className="text-cyan-400">Latest Training:</span> 1 hour ago</p>
            <p><span className="text-cyan-400">Data Points:</span> 847,392</p>
            <p><span className="text-cyan-400">Model Version:</span> v2.3.1</p>
            <p><span className="text-cyan-400">Next Training:</span> In 6 hours</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIEngine;
```

## CyberX-frontend/src/pages/Dashboard.tsx

```tsx
import React from 'react';
import type { DashboardMetrics } from '../types';

const Dashboard: React.FC = () => {
  // Mock data - replace with real API calls
  const metrics: DashboardMetrics = {
    activeAttacks: 12,
    totalSessions: 1847,
    blockedIPs: 2943,
    systemHealth: {
      cpu: 45,
      ram: 62,
      network: 28
    },
    topAttackers: ['192.168.1.100', '10.0.0.50', '172.16.0.25']
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-cyan-400">Central Command Center</h1>
        <div className="flex space-x-2">
          <button className="bg-green-500/20 text-green-400 border border-green-500/30 px-4 py-2 rounded-lg hover:bg-green-500/30 transition-colors">
            🟢 All Systems Online
          </button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Active Attacks</p>
              <p className="text-2xl font-bold text-red-400">{metrics.activeAttacks}</p>
            </div>
            <span className="text-3xl">🚨</span>
          </div>
          <div className="mt-2 text-xs text-gray-500">+3 from last hour</div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Total Sessions</p>
              <p className="text-2xl font-bold text-cyan-400">{metrics.totalSessions.toLocaleString()}</p>
            </div>
            <span className="text-3xl">📊</span>
          </div>
          <div className="mt-2 text-xs text-gray-500">+127 today</div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Blocked IPs</p>
              <p className="text-2xl font-bold text-yellow-400">{metrics.blockedIPs.toLocaleString()}</p>
            </div>
            <span className="text-3xl">🛡️</span>
          </div>
          <div className="mt-2 text-xs text-gray-500">Auto-blocked</div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">AI Risk Score</p>
              <p className="text-2xl font-bold text-purple-400">8.7/10</p>
            </div>
            <span className="text-3xl">🧠</span>
          </div>
          <div className="mt-2 text-xs text-red-400">High Risk</div>
        </div>
      </div>

      {/* System Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-cyan-400 mb-4">System Health</h2>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-gray-400">CPU Usage</span>
                <span className="text-sm text-white">{metrics.systemHealth.cpu}%</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-cyan-400 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${metrics.systemHealth.cpu}%` }}
                ></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-gray-400">RAM Usage</span>
                <span className="text-sm text-white">{metrics.systemHealth.ram}%</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-yellow-400 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${metrics.systemHealth.ram}%` }}
                ></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-gray-400">Network Load</span>
                <span className="text-sm text-white">{metrics.systemHealth.network}%</span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-green-400 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${metrics.systemHealth.network}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-cyan-400 mb-4">Top Attacker IPs</h2>
          <div className="space-y-3">
            {metrics.topAttackers.map((ip, index) => (
              <div key={ip} className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <span className="text-sm font-mono text-gray-300">{ip}</span>
                  <span className="text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded">High Risk</span>
                </div>
                <button className="text-xs text-cyan-400 hover:text-cyan-300">Block</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
        <h2 className="text-xl font-semibold text-cyan-400 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <button className="bg-blue-500/20 text-blue-400 border border-blue-500/30 p-4 rounded-lg hover:bg-blue-500/30 transition-colors text-center">
            <div className="text-2xl mb-2">🍯</div>
            <div className="text-sm font-medium">Deploy Honeypot</div>
          </button>
          <button className="bg-purple-500/20 text-purple-400 border border-purple-500/30 p-4 rounded-lg hover:bg-purple-500/30 transition-colors text-center">
            <div className="text-2xl mb-2">🧠</div>
            <div className="text-sm font-medium">Run AI Analysis</div>
          </button>
          <button className="bg-green-500/20 text-green-400 border border-green-500/30 p-4 rounded-lg hover:bg-green-500/30 transition-colors text-center">
            <div className="text-2xl mb-2">📊</div>
            <div className="text-sm font-medium">Generate Report</div>
          </button>
          <button className="bg-red-500/20 text-red-400 border border-red-500/30 p-4 rounded-lg hover:bg-red-500/30 transition-colors text-center">
            <div className="text-2xl mb-2">🚨</div>
            <div className="text-sm font-medium">Emergency Stop</div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
```

## CyberX-frontend/src/pages/DefensiveTools.tsx

```tsx
import React from 'react';

const DefensiveTools: React.FC = () => {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-green-400">Defensive Tools Suite</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-900/80 backdrop-blur-sm border border-green-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-green-400 mb-4">🛡️ Intrusion Detection</h2>
          <div className="space-y-3">
            <div className="text-sm text-gray-400">Rules Active: <span className="text-white">1,247</span></div>
            <div className="text-sm text-gray-400">Alerts Today: <span className="text-red-400">23</span></div>
            <button className="w-full bg-green-500/20 text-green-400 border border-green-500/30 px-4 py-2 rounded hover:bg-green-500/30 transition-colors">
              View IDS Dashboard
            </button>
          </div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-green-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-blue-400 mb-4">📝 Log Analysis</h2>
          <div className="space-y-3">
            <div className="text-sm text-gray-400">Logs Processed: <span className="text-white">2.3M</span></div>
            <div className="text-sm text-gray-400">Anomalies: <span className="text-yellow-400">47</span></div>
            <button className="w-full bg-blue-500/20 text-blue-400 border border-blue-500/30 px-4 py-2 rounded hover:bg-blue-500/30 transition-colors">
              Analyze Logs
            </button>
          </div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-green-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-purple-400 mb-4">📡 Traffic Monitor</h2>
          <div className="space-y-3">
            <div className="text-sm text-gray-400">Live Connections: <span className="text-white">156</span></div>
            <div className="text-sm text-gray-400">Bandwidth: <span className="text-cyan-400">2.1 Gbps</span></div>
            <button className="w-full bg-purple-500/20 text-purple-400 border border-purple-500/30 px-4 py-2 rounded hover:bg-purple-500/30 transition-colors">
              Monitor Traffic
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DefensiveTools;
```

## CyberX-frontend/src/pages/Home.tsx

```tsx
// src/pages/Home.tsx
import React from "react";
import { Link } from "react-router-dom";
import CyberpunkCard from "@/components/CyberpunkCard";
const NAV_H = 80; 

export default function Home() {
  return (
    <section
      className="
        relative z-20 grid
        min-h-[calc(100svh-var(--nav-h,80px))] place-items-center
        px-6
        ml-75
        -mt-20   /* remove this line if main no longer has pt-20 */
      "
      style={{ ["--nav-h" as any]: `${NAV_H}px` }}
    >
      {/* subtle global overlay for readability */}
      <div className="pointer-events-none fixed inset-0 -z-[1] bg-gradient-to-b from-black/35 via-black/20 to-black/45" />

      {/* centered glass card */}
      <div
        className="
          mx-auto w-fit max-w-[90vw] sm:max-w-3xl md:max-w-4xl
          bg-black/30 backdrop-blur-xl
          border border-white/10 rounded-2xl
          shadow-2xl ring-1 ring-white/5
          px-8 py-10 text-center
        "
      >
        <h1
          className="
            text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight
            text-transparent bg-clip-text
            bg-gradient-to-r from-cyan-300 via-fuchsia-300 to-pink-300
            drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]
          "
        >
          CyberX — <span className="text-white/95">Simulate</span>.{" "}
          <span className="text-white/95">Secure</span>.{" "}
          <span className="text-white/95">Succeed</span>.
        </h1>

        <p className="mt-5 text-lg md:text-xl text-white/90 drop-shadow-md">
          Everything cybersecurity under one umbrella.
        </p>

        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            to="/tools"
            className="rounded-lg px-5 py-3 bg-cyan-500/15 text-cyan-200 border border-cyan-400/25 hover:bg-cyan-500/25"
          >
            Explore Tools
          </Link>
          <Link
            to="/honeypot"
            className="rounded-lg px-5 py-3 bg-pink-500/15 text-pink-200 border border-pink-400/25 hover:bg-pink-500/25"
          >
            Launch Honeypots
          </Link>
        </div>
      </div>
    </section>
  );
}
```

## CyberX-frontend/src/pages/Honeypots.tsx

```tsx
import React, { useState } from 'react';

const Honeypots: React.FC = () => {
  const [activeTab, setActiveTab] = useState('overview');

  const honeypots = [
    { id: 1, name: 'SSH-Trap-01', type: 'SSH', status: 'active', attacks: 47, port: 22 },
    { id: 2, name: 'HTTP-Decoy-02', type: 'HTTP', status: 'active', attacks: 23, port: 80 },
    { id: 3, name: 'FTP-Bait-03', type: 'FTP', status: 'inactive', attacks: 12, port: 21 },
    { id: 4, name: 'DB-Honey-04', type: 'MySQL', status: 'active', attacks: 8, port: 3306 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-cyan-400">Honeypot Simulator</h1>
        <button className="bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-4 py-2 rounded-lg hover:bg-cyan-500/30 transition-colors">
          + Deploy New Honeypot
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-700">
        <nav className="-mb-px flex space-x-8">
          {['overview', 'sessions', 'logs', 'configuration'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab
                  ? 'border-cyan-500 text-cyan-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-300'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {/* Honeypot Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {honeypots.map((honeypot) => (
          <div key={honeypot.id} className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{honeypot.name}</h3>
                <p className="text-sm text-gray-400">{honeypot.type} Honeypot - Port {honeypot.port}</p>
              </div>
              <span
                className={`px-2 py-1 text-xs font-semibold rounded ${
                  honeypot.status === 'active'
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-gray-500/20 text-gray-400'
                }`}
              >
                {honeypot.status}
              </span>
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-400">Attacks Captured</span>
                <span className="text-sm font-semibold text-red-400">{honeypot.attacks}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-400">Last Activity</span>
                <span className="text-sm text-gray-300">2 min ago</span>
              </div>
            </div>

            <div className="mt-4 flex space-x-2">
              <button className="flex-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 px-3 py-2 rounded text-sm hover:bg-blue-500/30 transition-colors">
                View Sessions
              </button>
              <button className="flex-1 bg-purple-500/20 text-purple-400 border border-purple-500/30 px-3 py-2 rounded text-sm hover:bg-purple-500/30 transition-colors">
                Configure
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Active Sessions */}
      <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
        <h2 className="text-xl font-semibold text-cyan-400 mb-4">Live Attack Sessions</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="text-left py-2">IP Address</th>
                <th className="text-left py-2">Honeypot</th>
                <th className="text-left py-2">Started</th>
                <th className="text-left py-2">Commands</th>
                <th className="text-left py-2">Risk</th>
                <th className="text-left py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              <tr className="border-b border-gray-800">
                <td className="py-3 font-mono">192.168.1.100</td>
                <td className="py-3">SSH-Trap-01</td>
                <td className="py-3">5 min ago</td>
                <td className="py-3">12</td>
                <td className="py-3">
                  <span className="bg-red-500/20 text-red-400 px-2 py-1 rounded text-xs">High</span>
                </td>
                <td className="py-3">
                  <button className="text-cyan-400 hover:text-cyan-300 text-xs mr-2">View</button>
                  <button className="text-red-400 hover:text-red-300 text-xs">Block</button>
                </td>
              </tr>
              <tr className="border-b border-gray-800">
                <td className="py-3 font-mono">10.0.0.50</td>
                <td className="py-3">HTTP-Decoy-02</td>
                <td className="py-3">12 min ago</td>
                <td className="py-3">7</td>
                <td className="py-3">
                  <span className="bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded text-xs">Medium</span>
                </td>
                <td className="py-3">
                  <button className="text-cyan-400 hover:text-cyan-300 text-xs mr-2">View</button>
                  <button className="text-red-400 hover:text-red-300 text-xs">Block</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Honeypots;
```

## CyberX-frontend/src/pages/OffensiveTools.tsx

```tsx
import React from 'react';

const OffensiveTools: React.FC = () => {
  const tools = [
    { name: 'Port Scanner', icon: '🔍', description: 'Nmap-like port scanning capabilities', status: 'ready' },
    { name: 'Subdomain Enum', icon: '🌐', description: 'Discover subdomains and services', status: 'ready' },
    { name: 'Directory Fuzzer', icon: '📁', description: 'Find hidden endpoints and files', status: 'ready' },
    { name: 'SQL Injection Tester', icon: '💉', description: 'Test for SQL injection vulnerabilities', status: 'beta' },
    { name: 'XSS Scanner', icon: '🔬', description: 'Cross-site scripting vulnerability scanner', status: 'beta' },
    { name: 'Credential Stuffing', icon: '🔑', description: 'Test credential reuse attacks', status: 'dev' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-red-400">Offensive Tools Suite</h1>
        <div className="text-sm bg-red-500/20 text-red-400 px-3 py-1 rounded border border-red-500/30">
          ⚠️ Use Responsibly - Ethical Hacking Only
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tools.map((tool, index) => (
          <div key={index} className="bg-gray-900/80 backdrop-blur-sm border border-red-500/20 p-6 rounded-lg hover:border-red-500/40 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <span className="text-3xl">{tool.icon}</span>
              <span className={`px-2 py-1 text-xs font-semibold rounded ${
                tool.status === 'ready' ? 'bg-green-500/20 text-green-400' :
                tool.status === 'beta' ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-blue-500/20 text-blue-400'
              }`}>
                {tool.status}
              </span>
            </div>
            
            <h3 className="text-lg font-semibold text-white mb-2">{tool.name}</h3>
            <p className="text-sm text-gray-400 mb-4">{tool.description}</p>
            
            <button className="w-full bg-red-500/20 text-red-400 border border-red-500/30 px-4 py-2 rounded hover:bg-red-500/30 transition-colors">
              Launch Tool
            </button>
          </div>
        ))}
      </div>

      {/* Recent Scans */}
      <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
        <h2 className="text-xl font-semibold text-cyan-400 mb-4">Recent Scans</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="text-left py-2">Target</th>
                <th className="text-left py-2">Tool</th>
                <th className="text-left py-2">Started</th>
                <th className="text-left py-2">Status</th>
                <th className="text-left py-2">Results</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              <tr className="border-b border-gray-800">
                <td className="py-3 font-mono">192.168.1.0/24</td>
                <td className="py-3">Port Scanner</td>
                <td className="py-3">5 min ago</td>
                <td className="py-3">
                  <span className="bg-green-500/20 text-green-400 px-2 py-1 rounded text-xs">Complete</span>
                </td>
                <td className="py-3">23 open ports</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default OffensiveTools;
```

## CyberX-frontend/src/pages/PortScanner.tsx

```tsx
import React, { useState } from 'react';

type ScanRow = {
  port: number;
  protocol: 'tcp'|'udp';
  state: 'open'|'closed'|'filtered'|'open|filtered';
  reason: string;
  latencyMs: number|null;
};

export default function PortScannerPage() {
  const [target, setTarget] = useState('scanme.nmap.org');
  const [ports, setPorts] = useState('22,53,80,443,8000-8010');
  const [tcp, setTcp] = useState(true);
  const [udp, setUdp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [error, setError] = useState<string|null>(null);

  const runScan = async () => {
    setLoading(true); setError(null); setRows([]);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, ports, tcp, udp, timeoutMs: 1200, concurrency: 200, retries: 2 })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.results);
    } catch (e:any) {
      setError(e.message || 'scan failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative z-20 mx-auto max-w-4xl p-6 bg-black/30 backdrop-blur-xl rounded-2xl border border-white/10">
      <h2 className="text-2xl font-bold mb-4">Port Scanner</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <label className="flex flex-col">
          <span className="text-sm mb-1">Target (host/IP)</span>
          <input className="bg-black/40 border border-white/10 rounded px-3 py-2" value={target} onChange={e=>setTarget(e.target.value)} />
        </label>
        <label className="flex flex-col">
          <span className="text-sm mb-1">Ports (e.g. 22,80,443,8000-8100)</span>
          <input className="bg-black/40 border border-white/10 rounded px-3 py-2" value={ports} onChange={e=>setPorts(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={tcp} onChange={e=>setTcp(e.target.checked)} />
          <span>TCP</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={udp} onChange={e=>setUdp(e.target.checked)} />
          <span>UDP</span>
        </label>
      </div>
      <button disabled={loading} onClick={runScan}
        className="px-4 py-2 rounded bg-cyan-600/30 border border-cyan-400/40 hover:bg-cyan-600/40">
        {loading ? 'Scanning…' : 'Scan'}
      </button>

      {error && <p className="mt-4 text-red-300">{error}</p>}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-white/80">
            <tr>
              <th className="text-left p-2">Port</th>
              <th className="text-left p-2">Proto</th>
              <th className="text-left p-2">State</th>
              <th className="text-left p-2">Reason</th>
              <th className="text-left p-2">Latency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/10">
                <td className="p-2">{r.port}</td>
                <td className="p-2">{r.protocol}</td>
                <td className="p-2">{r.state}</td>
                <td className="p-2">{r.reason}</td>
                <td className="p-2">{r.latencyMs ?? '-' } ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

## CyberX-frontend/src/pages/Settings.tsx

```tsx
import React from 'react';

const Settings: React.FC = () => {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-cyan-400">System Settings & Deployment</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-cyan-400 mb-4">🐳 Docker Configuration</h2>
          <div className="space-y-4">
            <div className="text-sm text-gray-400">Containers Running: <span className="text-green-400">12</span></div>
            <div className="text-sm text-gray-400">Total Memory: <span className="text-white">4.2 GB</span></div>
            <div className="text-sm text-gray-400">CPU Usage: <span className="text-yellow-400">34%</span></div>
            <button className="w-full bg-blue-500/20 text-blue-400 border border-blue-500/30 px-4 py-2 rounded hover:bg-blue-500/30 transition-colors">
              Manage Containers
            </button>
          </div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-purple-400 mb-4">☸️ Kubernetes</h2>
          <div className="space-y-4">
            <div className="text-sm text-gray-400">Pods Running: <span className="text-green-400">8</span></div>
            <div className="text-sm text-gray-400">Nodes: <span className="text-white">3</span></div>
            <div className="text-sm text-gray-400">Cluster Health: <span className="text-green-400">Healthy</span></div>
            <button className="w-full bg-purple-500/20 text-purple-400 border border-purple-500/30 px-4 py-2 rounded hover:bg-purple-500/30 transition-colors">
              K8s Dashboard
            </button>
          </div>
        </div>
      </div>

      <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
        <h2 className="text-xl font-semibold text-cyan-400 mb-4">⚙️ System Configuration</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">AI Engine Mode</label>
            <select className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white">
              <option>Aggressive</option>
              <option>Balanced</option>
              <option>Conservative</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Log Level</label>
            <select className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white">
              <option>DEBUG</option>
              <option>INFO</option>
              <option>WARN</option>
              <option>ERROR</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Auto-Block Threshold</label>
            <select className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white">
              <option>High (8+)</option>
              <option>Medium (6+)</option>
              <option>Low (4+)</option>
            </select>
          </div>
        </div>
        <button className="mt-4 bg-green-500/20 text-green-400 border border-green-500/30 px-6 py-2 rounded hover:bg-green-500/30 transition-colors">
          Save Configuration
        </button>
      </div>
    </div>
  );
};

export default Settings;
```

## CyberX-frontend/src/pages/Simulations.tsx

```tsx
import React from 'react';

const Simulations: React.FC = () => {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-cyan-400">Simulation Environments</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-gray-900/80 backdrop-blur-sm border border-red-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-red-400 mb-4">🧪 Attack Lab</h2>
          <p className="text-gray-300 text-sm mb-4">Practice offensive techniques in a safe environment</p>
          <div className="space-y-2 mb-4">
            <div className="text-sm text-gray-400">Available Scenarios: <span className="text-white">15</span></div>
            <div className="text-sm text-gray-400">Your Progress: <span className="text-yellow-400">60%</span></div>
          </div>
          <button className="w-full bg-red-500/20 text-red-400 border border-red-500/30 px-4 py-2 rounded hover:bg-red-500/30 transition-colors">
            Enter Attack Lab
          </button>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-green-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-green-400 mb-4">🔒 Defense Lab</h2>
          <p className="text-gray-300 text-sm mb-4">Deploy and configure defensive measures</p>
          <div className="space-y-2 mb-4">
            <div className="text-sm text-gray-400">Active Defenses: <span className="text-white">8</span></div>
            <div className="text-sm text-gray-400">Success Rate: <span className="text-green-400">92%</span></div>
          </div>
          <button className="w-full bg-green-500/20 text-green-400 border border-green-500/30 px-4 py-2 rounded hover:bg-green-500/30 transition-colors">
            Enter Defense Lab
          </button>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-purple-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-purple-400 mb-4">🏆 CTF Arena</h2>
          <p className="text-gray-300 text-sm mb-4">Capture the Flag challenges and competitions</p>
          <div className="space-y-2 mb-4">
            <div className="text-sm text-gray-400">Your Rank: <span className="text-white">#23</span></div>
            <div className="text-sm text-gray-400">Points: <span className="text-purple-400">1,847</span></div>
          </div>
          <button className="w-full bg-purple-500/20 text-purple-400 border border-purple-500/30 px-4 py-2 rounded hover:bg-purple-500/30 transition-colors">
            Join CTF
          </button>
        </div>
      </div>

      <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
        <h2 className="text-xl font-semibold text-cyan-400 mb-4">🎮 Active Challenges</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gray-800/50 p-4 rounded-lg">
            <h3 className="font-semibold text-white mb-2">SQL Injection Master</h3>
            <p className="text-sm text-gray-400 mb-3">Complete all SQL injection challenges</p>
            <div className="flex justify-between items-center">
              <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded">Beginner</span>
              <span className="text-xs text-gray-400">7/10 completed</span>
            </div>
          </div>
          <div className="bg-gray-800/50 p-4 rounded-lg">
            <h3 className="font-semibold text-white mb-2">Network Defender</h3>
            <p className="text-sm text-gray-400 mb-3">Set up honeypots to catch 50 attackers</p>
            <div className="flex justify-between items-center">
              <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded">Intermediate</span>
              <span className="text-xs text-gray-400">23/50 caught</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Simulations;
```

## CyberX-frontend/src/pages/Tools.tsx

```tsx
import React from 'react';

const Tools: React.FC = () => {
  const communityTools = [
    { name: 'URL Scanner', icon: '🔗', description: 'Scan URLs for security issues' },
    { name: 'DNS Resolver', icon: '🌐', description: 'Advanced DNS lookup and analysis' },
    { name: 'JWT Inspector', icon: '🔑', description: 'Decode and analyze JWT tokens' },
    { name: 'Hash Analyzer', icon: '#️⃣', description: 'Identify and crack hash formats' },
    { name: 'Base64 Decoder', icon: '🔓', description: 'Encode/decode Base64 strings' },
    { name: 'API Key Checker', icon: '🗝️', description: 'Validate API keys and tokens' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-cyan-400">Security Tools</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {communityTools.map((tool, index) => (
          <div key={index} className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg hover:border-cyan-500/40 transition-colors">
            <div className="text-center mb-4">
              <span className="text-4xl">{tool.icon}</span>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2 text-center">{tool.name}</h3>
            <p className="text-sm text-gray-400 mb-4 text-center">{tool.description}</p>
            <button className="w-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-4 py-2 rounded hover:bg-cyan-500/30 transition-colors">
              Open Tool
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Tools;
```

## CyberX-frontend/src/pages/Visualization.tsx

```tsx
import React from 'react';

const Visualization: React.FC = () => {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-cyan-400">Visualization & Reporting</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-cyan-400 mb-4">🗺️ Live Attack Map</h2>
          <div className="bg-gray-800/50 rounded-lg p-4 h-64 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <div className="text-4xl mb-2">🌍</div>
              <p>Interactive world map showing real-time attacks</p>
              <button className="mt-4 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-4 py-2 rounded hover:bg-cyan-500/30 transition-colors">
                Launch Map
              </button>
            </div>
          </div>
        </div>

        <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
          <h2 className="text-xl font-semibold text-purple-400 mb-4">▶️ Session Replay</h2>
          <div className="bg-gray-800/50 rounded-lg p-4 h-64 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <div className="text-4xl mb-2">🎬</div>
              <p>Replay attacker sessions step by step</p>
              <button className="mt-4 bg-purple-500/20 text-purple-400 border border-purple-500/30 px-4 py-2 rounded hover:bg-purple-500/30 transition-colors">
                View Sessions
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gray-900/80 backdrop-blur-sm border border-cyan-500/20 p-6 rounded-lg">
        <h2 className="text-xl font-semibold text-green-400 mb-4">📊 Threat Reports</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button className="bg-green-500/20 text-green-400 border border-green-500/30 p-4 rounded-lg hover:bg-green-500/30 transition-colors text-center">
            <div className="text-2xl mb-2">📄</div>
            <div>Daily Report</div>
          </button>
          <button className="bg-blue-500/20 text-blue-400 border border-blue-500/30 p-4 rounded-lg hover:bg-blue-500/30 transition-colors text-center">
            <div className="text-2xl mb-2">📈</div>
            <div>Weekly Summary</div>
          </button>
          <button className="bg-purple-500/20 text-purple-400 border border-purple-500/30 p-4 rounded-lg hover:bg-purple-500/30 transition-colors text-center">
            <div className="text-2xl mb-2">📋</div>
            <div>Custom Report</div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Visualization;
```

## CyberX-frontend/src/routes/app-router.tsx

```tsx
import React from 'react';
import type { RouteObject } from 'react-router-dom';
import { createBrowserRouter, Outlet } from 'react-router-dom';
import Layout from '@/components/layout/Layout';  

const pages = import.meta.glob('../pages/**/[A-Za-z0-9][A-Za-z0-9-_]*/index.{tsx,jsx}', { import: 'default' });
const singlePages = import.meta.glob('../pages/**/[A-Za-z0-9][A-Za-z0-9-_]*.{tsx,jsx}', { import: 'default' });

const Placeholder: React.FC<{ title: string }> = ({ title }) => (
  <div className="p-8 text-center">
    <h1 className="text-2xl font-bold mb-2">{title}</h1>
    <p className="text-gray-400">Scaffold this page at src/pages/{title}.tsx or the configured path.</p>
  </div>
);

export type RouteCategory =
  | 'dashboard'
  | 'honeypot'
  | 'ids'
  | 'siem'
  | 'tools'
  | 'ai'
  | 'reports'
  | 'viz'
  | 'sim'
  | 'cloud'
  | 'crypto'
  | 'stego'
  | 'intel'
  | 'misc';

export interface RouteMeta {
  id: string;
  title: string;
  icon?: string;
  category: RouteCategory;
  description?: string;
  tags?: string[];
  hidden?: boolean;
}

export interface AppRouteDef {
  path: string;            
  page?: string;           
  meta: RouteMeta;
  children?: AppRouteDef[];
  index?: boolean;
}

function lazyFrom(page?: string, title?: string): Pick<RouteObject, 'lazy' | 'Component'> {
  if (!page) return { Component: () => <Placeholder title={title ?? 'Page'} /> };

  const normalizedCandidates = [
    `../pages/${page}/index.tsx`,
    `../pages/${page}/index.jsx`,
    `../pages/${page}.tsx`,
    `../pages/${page}.jsx`,
  ];

  const match =
    normalizedCandidates.find((p) => p in pages) ??
    normalizedCandidates.find((p) => p in singlePages);

  if (match && (pages as Record<string, any>)[match]) {
    return {
      lazy: async () => {
        const Comp = await (pages as Record<string, any>)[match]();
        return { Component: Comp as React.ComponentType };
      },
    };
  }

  if (match && (singlePages as Record<string, any>)[match]) {
    return {
      lazy: async () => {
        const Comp = await (singlePages as Record<string, any>)[match]();
        return { Component: Comp as React.ComponentType };
      },
    };
  }

  return { Component: () => <Placeholder title={page} /> };
}

// Global route registry (add/rename here only)
export const ROUTES: AppRouteDef[] = [
  {
    path: '/',
    page: 'Home',
    index: true,
    meta: { id: 'home', title: 'Home', icon: '🏠', category: 'dashboard', tags: ['overview'] },
  },

  // Honeypot & Defense
  {
    path: 'honeypot',
    page: 'honeypot/Dashboard',
    meta: { id: 'honeypot', title: 'Honeypot Simulator', icon: '🍯', category: 'honeypot' },
    children: [
      { path: 'ssh', page: 'honeypot/SSH', meta: { id: 'hp-ssh', title: 'SSH Honeypot', category: 'honeypot' } },
      { path: 'http', page: 'honeypot/HTTP', meta: { id: 'hp-http', title: 'HTTP Honeypot', category: 'honeypot' } },
      { path: 'db', page: 'honeypot/Database', meta: { id: 'hp-db', title: 'Database Honeypot', category: 'honeypot' } },
      { path: 'custom', page: 'honeypot/Custom', meta: { id: 'hp-custom', title: 'Custom Socket', category: 'honeypot' } },
    ],
  },
  { path: 'ids', page: 'defense/IDS', meta: { id: 'ids', title: 'Intrusion Detection', icon: '🛡️', category: 'ids' } },
  { path: 'siem', page: 'defense/SIEM', meta: { id: 'siem', title: 'Log Monitoring & SIEM', icon: '🗄️', category: 'siem' } },

  // AI & Intelligence
  { path: 'ai/engine', page: 'ai/Engine', meta: { id: 'ai-engine', title: 'Adaptive Threat Engine', icon: '🧠', category: 'ai' } },
  { path: 'ai/phishing', page: 'ai/PhishingDetector', meta: { id: 'ai-phish', title: 'AI Phishing Detector', category: 'ai' } },
  { path: 'ai/malware', page: 'ai/MalwareClassifier', meta: { id: 'ai-malware', title: 'AI Malware Classifier', category: 'ai' } },
  { path: 'intel', page: 'intel/ThreatIntel', meta: { id: 'intel', title: 'Threat Intelligence', icon: '🔍', category: 'intel' } },

  // Visualization & Reports
  { path: 'visualizer', page: 'viz/AttackVisualizer', meta: { id: 'visualizer', title: 'Attack Visualizer', icon: '📈', category: 'viz' } },
  { path: 'reports', page: 'reports/ThreatReports', meta: { id: 'reports', title: 'Reports', icon: '📊', category: 'reports' } },

  // Simulations
  { path: 'sim/rt-vs-bt', page: 'sim/RedVsBlue', meta: { id: 'sim-rtbt', title: 'Red vs Blue Simulator', icon: '🎮', category: 'sim' } },

  // Core Tools (Offensive/Recon/Cloud/Crypto/Stego/Misc)
  {
    path: 'tools',
    page: 'tools/Index',
    meta: { id: 'tools', title: 'Tools', icon: '🔧', category: 'tools' },
    children: [
      // Recon
      { path: 'port-scanner', page: 'tools/PortScanner', meta: { id: 'port-scan', title: 'Port Scanner', category: 'tools', tags: ['tcp','udp'] } },
      { path: 'service-detect', page: 'tools/ServiceDetection', meta: { id: 'svc-detect', title: 'Service & Version Detection', category: 'tools' } },
      { path: 'os-fingerprint', page: 'tools/OSFingerprint', meta: { id: 'os-fp', title: 'OS Fingerprinting', category: 'tools' } },
      { path: 'subdomains', page: 'tools/SubdomainEnum', meta: { id: 'sub-enum', title: 'Subdomain Enumeration', category: 'tools' } },
      { path: 'whois', page: 'tools/Whois', meta: { id: 'whois', title: 'WHOIS Lookup', category: 'tools' } },
      { path: 'dns-recon', page: 'tools/DNSRecon', meta: { id: 'dns-recon', title: 'DNS Recon', category: 'tools' } },
      { path: 'reverse-ip', page: 'tools/ReverseIP', meta: { id: 'rev-ip', title: 'Reverse IP Lookup', category: 'tools' } },
      { path: 'ip-geo', page: 'tools/IPGeolocation', meta: { id: 'ip-geo', title: 'IP Geolocation', category: 'tools' } },
      { path: 'dir-fuzzer', page: 'tools/DirFuzzer', meta: { id: 'dir-fuzz', title: 'Directory & File Fuzzer', category: 'tools' } },
      { path: 'vuln-fuzzer', page: 'tools/VulnFuzzer', meta: { id: 'vuln-fuzz', title: 'Vulnerability Fuzzer', category: 'tools' } },
      { path: 'api-scanner', page: 'tools/APIScanner', meta: { id: 'api-scan', title: 'API Endpoint Scanner', category: 'tools' } },
      { path: 'broken-auth', page: 'tools/BrokenAuth', meta: { id: 'broken-auth', title: 'Broken Auth Detector', category: 'tools' } },

      // Cloud & Containers
      { path: 's3-finder', page: 'cloud/S3Finder', meta: { id: 's3', title: 'S3 Bucket Finder', category: 'cloud' } },
      { path: 'container-scan', page: 'cloud/ContainerScanner', meta: { id: 'containers', title: 'Container CVE Scanner', category: 'cloud' } },
      { path: 'k8s-enum', page: 'cloud/K8sEnum', meta: { id: 'k8s', title: 'Kubernetes Enum', category: 'cloud' } },

      // Crypto/Hashing
      { path: 'hash-cracker', page: 'crypto/HashCracker', meta: { id: 'hash', title: 'Hash Generator/Cracker', category: 'crypto' } },
      { path: 'ciphers', page: 'crypto/CipherTools', meta: { id: 'ciphers', title: 'Cipher Encoder/Decoder', category: 'crypto' } },
      { path: 'rsa-aes', page: 'crypto/RsaAes', meta: { id: 'rsa-aes', title: 'RSA/AES Encrypt/Decrypt', category: 'crypto' } },
      { path: 'jwt', page: 'crypto/JWTDecoder', meta: { id: 'jwt', title: 'JWT Decoder', category: 'crypto' } },

      // Steganography & Media
      { path: 'stego-image', page: 'stego/ImageStego', meta: { id: 'stego-img', title: 'Image Steganography', category: 'stego' } },
      { path: 'stego-audio', page: 'stego/AudioStego', meta: { id: 'stego-audio', title: 'Audio Steganography', category: 'stego' } },
      { path: 'stego-extract', page: 'stego/StegoExtract', meta: { id: 'stego-extract', title: 'Stego Extractor', category: 'stego' } },
      { path: 'image-exif', page: 'stego/ImageMetadata', meta: { id: 'exif', title: 'Image Metadata Analyzer', category: 'stego' } },

      // Intelligence & OSINT
      { path: 'breach-check', page: 'intel/BreachChecker', meta: { id: 'breach', title: 'Email Breach Checker', category: 'intel' } },
      { path: 'google-dorks', page: 'intel/GoogleDorker', meta: { id: 'dorks', title: 'Google Dorking', category: 'intel' } },
      { path: 'shodan-censys', page: 'intel/ShodanCensys', meta: { id: 'shodan', title: 'Shodan & Censys', category: 'intel' } },
      { path: 'pastebin-leaks', page: 'intel/PastebinLeaks', meta: { id: 'pastebin', title: 'Pastebin Leak Finder', category: 'intel' } },

      // Low-level/Analysis
      { path: 'mem-dump', page: 'misc/MemoryDump', meta: { id: 'memdump', title: 'Memory Dump Analyzer', category: 'misc' } },
      { path: 'packet-analyzer', page: 'misc/PacketAnalyzer', meta: { id: 'pcap', title: 'Network Packet Analyzer', category: 'misc' } },
    ],
  },

  // Fallbacks
  { path: 'about', page: 'About', meta: { id: 'about', title: 'About', category: 'misc' } },
  { path: '*', page: 'NotFound', meta: { id: '404', title: 'Not Found', category: 'misc', hidden: true } },
];

function mapDefs(defs: AppRouteDef[]): RouteObject[] {
  return defs.map((def) => {
    const route: RouteObject = {
      path: def.path,
      index: def.index,
      ...lazyFrom(def.page, def.meta.title),
    };
    if (def.children?.length) {
      route.children = mapDefs(def.children);
    }
    return route;
  });
}

const rootRoute: RouteObject = {
  path: '/',
  element: <Layout><Outlet /></Layout>, 
  children: mapDefs(ROUTES),            
};

export const router = createBrowserRouter([rootRoute]);

export const flatRoutes = (defs: AppRouteDef[] = ROUTES): RouteMeta[] => {
  const out: RouteMeta[] = [];
  const walk = (arr: AppRouteDef[]) => {
    arr.forEach((r) => {
      out.push(r.meta);
      if (r.children) walk(r.children);
    });
  };
  walk(defs);
  return out;
};

export const findById = (id: string, defs: AppRouteDef[] = ROUTES): AppRouteDef | undefined => {
  for (const r of defs) {
    if (r.meta.id === id) return r;
    if (r.children) {
      const f = findById(id, r.children);
      if (f) return f;
    }
  }
  return undefined;
};
```

## CyberX-frontend/src/types/index.ts

```ts
// Core types for the CyberX platform
export interface User {
  id: string;
  email: string;
  role: 'admin' | 'analyst' | 'guest';
  name: string;
  avatar?: string;
}

export interface HoneypotSession {
  id: string;
  ip: string;
  country: string;
  startTime: Date;
  endTime?: Date;
  commands: string[];
  serviceType: 'ssh' | 'http' | 'ftp' | 'database' | 'custom';
  status: 'active' | 'closed' | 'blocked';
}

export interface ThreatScore {
  ip: string;
  score: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  lastActivity: Date;
  attackTypes: string[];
}

export interface DashboardMetrics {
  activeAttacks: number;
  totalSessions: number;
  blockedIPs: number;
  systemHealth: {
    cpu: number;
    ram: number;
    network: number;
  };
  topAttackers: string[];
}

export interface NavItem {
  id: string;
  title: string;
  icon: string;
  path: string;
  children?: NavItem[];
}
```

## CyberX-frontend/src/App.css

```css
#root {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}
.logo.react:hover {
  filter: drop-shadow(0 0 2em #61dafbaa);
}

@keyframes logo-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: no-preference) {
  a:nth-of-type(2) .logo {
    animation: logo-spin infinite 20s linear;
  }
}

.card {
  padding: 2em;
}

.read-the-docs {
  color: #888;
}
```

## CyberX-frontend/src/App.tsx

```tsx
// src/App.tsx
import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes/app-router';

export default function App() {
  return <RouterProvider router={router} />;
}
```

## CyberX-frontend/src/index.css

```css


@import "tailwindcss";
@tailwind base;
@tailwind components;
@tailwind utilities;
:root {
  font-family: system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;

  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);
}

a {
  font-weight: 500;
  color: #646cff;
  text-decoration: inherit;
}
a:hover {
  color: #535bf2;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}

h1 {
  font-size: 3.2em;
  line-height: 1.1;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  cursor: pointer;
  transition: border-color 0.25s;
}
button:hover {
  border-color: #646cff;
}
button:focus,
button:focus-visible {
  outline: 4px auto -webkit-focus-ring-color;
}

@media (prefers-color-scheme: light) {
  :root {
    color: #213547;
    background-color: #ffffff;
  }
  a:hover {
    color: #747bff;
  }
  button {
    background-color: #f9f9f9;
  }
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: oklch(0.205 0 0);
  --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.269 0 0);
  --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.556 0 0);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}

html, body, #root {
  background: transparent !important;
  height: 100%;
}
```

## CyberX-frontend/src/main.tsx

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

## CyberX-frontend/src/vite-env.d.ts

```ts
/// <reference types="vite/client" />
```

## CyberX-frontend/.gitignore

```
# Python
__pycache__/
*.pyc
venv/
.env

# Node
node_modules/
dist/
.vscode/

# Logs
*.log
data/logs/
```

## CyberX-frontend/components.json

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "registries": {}
}
```

## CyberX-frontend/eslint.config.js

```js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
)
```

## CyberX-frontend/index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/half_logo.jpg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CyberX</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

## CyberX-frontend/package-lock.json

```json
{
  "name": "cyberx-frontend",
  "version": "0.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "cyberx-frontend",
      "version": "0.0.0",
      "dependencies": {
        "@tailwindcss/vite": "^4.1.13",
        "class-variance-authority": "^0.7.1",
        "clsx": "^2.1.1",
        "lucide-react": "^0.542.0",
        "motion": "^12.23.12",
        "react": "^19.1.0",
        "react-dom": "^19.1.0",
        "react-router-dom": "^6.28.0",
        "tailwind-merge": "^3.3.1",
        "tailwindcss-animate": "^1.0.7"
      },
      "devDependencies": {
        "@eslint/js": "^9.25.0",
        "@types/node": "^24.3.1",
        "@types/react": "^19.1.2",
        "@types/react-dom": "^19.1.2",
        "@vitejs/plugin-react": "^4.4.1",
        "autoprefixer": "^10.4.21",
        "eslint": "^9.25.0",
        "eslint-plugin-react-hooks": "^5.2.0",
        "eslint-plugin-react-refresh": "^0.4.19",
        "globals": "^16.0.0",
        "postcss": "^8.5.6",
        "tailwindcss": "^4.1.13",
        "typescript": "~5.8.3",
        "typescript-eslint": "^8.30.1",
        "vite": "^6.3.5"
      }
    },
    "node_modules/@ampproject/remapping": {
      "version": "2.3.0",
      "resolved": "https://registry.npmjs.org/@ampproject/remapping/-/remapping-2.3.0.tgz",
      "integrity": "sha512-30iZtAPgz+LTIYoeivqYo853f02jBYSd5uGnGpkFV0M3xOt9aN73erkgYAmZU43x4VfqcnLxW9Kpg3R5LC4YYw==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@jridgewell/gen-mapping": "^0.3.5",
        "@jridgewell/trace-mapping": "^0.3.24"
      },
      "engines": {
        "node": ">=6.0.0"
      }
    },
    "node_modules/@babel/code-frame": {
      "version": "7.27.1",
      "resolved": "https://registry.npmjs.org/@babel/code-frame/-/code-frame-7.27.1.tgz",
      "integrity": "sha512-cjQ7ZlQ0Mv3b47hABuTevyTuYN4i+loJKGeV9flcCgIK37cCXRh+L1bd3iBHlynerhQ7BhCkn2BPbQUL+rGqFg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-validator-identifier": "^7.27.1",
        "js-tokens": "^4.0.0",
        "picocolors": "^1.1.1"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/compat-data": {
      "version": "7.27.5",
      "resolved": "https://registry.npmjs.org/@babel/compat-data/-/compat-data-7.27.5.tgz",
      "integrity": "sha512-KiRAp/VoJaWkkte84TvUd9qjdbZAdiqyvMxrGl1N6vzFogKmaLgoM3L1kgtLicp2HP5fBJS8JrZKLVIZGVJAVg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/core": {
      "version": "7.27.4",
      "resolved": "https://registry.npmjs.org/@babel/core/-/core-7.27.4.tgz",
      "integrity": "sha512-bXYxrXFubeYdvB0NhD/NBB3Qi6aZeV20GOWVI47t2dkecCEoneR4NPVcb7abpXDEvejgrUfFtG6vG/zxAKmg+g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@ampproject/remapping": "^2.2.0",
        "@babel/code-frame": "^7.27.1",
        "@babel/generator": "^7.27.3",
        "@babel/helper-compilation-targets": "^7.27.2",
        "@babel/helper-module-transforms": "^7.27.3",
        "@babel/helpers": "^7.27.4",
        "@babel/parser": "^7.27.4",
        "@babel/template": "^7.27.2",
        "@babel/traverse": "^7.27.4",
        "@babel/types": "^7.27.3",
        "convert-source-map": "^2.0.0",
        "debug": "^4.1.0",
        "gensync": "^1.0.0-beta.2",
        "json5": "^2.2.3",
        "semver": "^6.3.1"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/babel"
      }
    },
    "node_modules/@babel/generator": {
      "version": "7.27.5",
      "resolved": "https://registry.npmjs.org/@babel/generator/-/generator-7.27.5.tgz",
      "integrity": "sha512-ZGhA37l0e/g2s1Cnzdix0O3aLYm66eF8aufiVteOgnwxgnRP8GoyMj7VWsgWnQbVKXyge7hqrFh2K2TQM6t1Hw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/parser": "^7.27.5",
        "@babel/types": "^7.27.3",
        "@jridgewell/gen-mapping": "^0.3.5",
        "@jridgewell/trace-mapping": "^0.3.25",
        "jsesc": "^3.0.2"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-compilation-targets": {
      "version": "7.27.2",
      "resolved": "https://registry.npmjs.org/@babel/helper-compilation-targets/-/helper-compilation-targets-7.27.2.tgz",
      "integrity": "sha512-2+1thGUUWWjLTYTHZWK1n8Yga0ijBz1XAhUXcKy81rd5g6yh7hGqMp45v7cadSbEHc9G3OTv45SyneRN3ps4DQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/compat-data": "^7.27.2",
        "@babel/helper-validator-option": "^7.27.1",
        "browserslist": "^4.24.0",
        "lru-cache": "^5.1.1",
        "semver": "^6.3.1"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-module-imports": {
      "version": "7.27.1",
      "resolved": "https://registry.npmjs.org/@babel/helper-module-imports/-/helper-module-imports-7.27.1.tgz",
      "integrity": "sha512-0gSFWUPNXNopqtIPQvlD5WgXYI5GY2kP2cCvoT8kczjbfcfuIljTbcWrulD1CIPIX2gt1wghbDy08yE1p+/r3w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/traverse": "^7.27.1",
        "@babel/types": "^7.27.1"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-module-transforms": {
      "version": "7.27.3",
      "resolved": "https://registry.npmjs.org/@babel/helper-module-transforms/-/helper-module-transforms-7.27.3.tgz",
      "integrity": "sha512-dSOvYwvyLsWBeIRyOeHXp5vPj5l1I011r52FM1+r1jCERv+aFXYk4whgQccYEGYxK2H3ZAIA8nuPkQ0HaUo3qg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-module-imports": "^7.27.1",
        "@babel/helper-validator-identifier": "^7.27.1",
        "@babel/traverse": "^7.27.3"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0"
      }
    },
    "node_modules/@babel/helper-plugin-utils": {
      "version": "7.27.1",
      "resolved": "https://registry.npmjs.org/@babel/helper-plugin-utils/-/helper-plugin-utils-7.27.1.tgz",
      "integrity": "sha512-1gn1Up5YXka3YYAHGKpbideQ5Yjf1tDa9qYcgysz+cNCXukyLl6DjPXhD3VRwSb8c0J9tA4b2+rHEZtc6R0tlw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-string-parser": {
      "version": "7.27.1",
      "resolved": "https://registry.npmjs.org/@babel/helper-string-parser/-/helper-string-parser-7.27.1.tgz",
      "integrity": "sha512-qMlSxKbpRlAridDExk92nSobyDdpPijUq2DW6oDnUqd0iOGxmQjyqhMIihI9+zv4LPyZdRje2cavWPbCbWm3eA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-validator-identifier": {
      "version": "7.27.1",
      "resolved": "https://registry.npmjs.org/@babel/helper-validator-identifier/-/helper-validator-identifier-7.27.1.tgz",
      "integrity": "sha512-D2hP9eA+Sqx1kBZgzxZh0y1trbuU+JoDkiEwqhQ36nodYqJwyEIhPSdMNd7lOm/4io72luTPWH20Yda0xOuUow==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-validator-option": {
      "version": "7.27.1",
      "resolved": "https://registry.npmjs.org/@babel/helper-validator-option/-/helper-validator-option-7.27.1.tgz",
      "integrity": "sha512-YvjJow9FxbhFFKDSuFnVCe2WxXk1zWc22fFePVNEaWJEu8IrZVlda6N0uHwzZrUM1il7NC9Mlp4MaJYbYd9JSg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helpers": {
      "version": "7.27.6",
      "resolved": "https://registry.npmjs.org/@babel/helpers/-/helpers-7.27.6.tgz",
      "integrity": "sha512-muE8Tt8M22638HU31A3CgfSUciwz1fhATfoVai05aPXGor//CdWDCbnlY1yvBPo07njuVOCNGCSp/GTt12lIug==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/template": "^7.27.2",
        "@babel/types": "^7.27.6"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/parser": {
      "version": "7.27.5",
      "resolved": "https://registry.npmjs.org/@babel/parser/-/parser-7.27.5.tgz",
      "integrity": "sha512-OsQd175SxWkGlzbny8J3K8TnnDD0N3lrIUtB92xwyRpzaenGZhxDvxN/JgU00U3CDZNj9tPuDJ5H0WS4Nt3vKg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/types": "^7.27.3"
      },
      "bin": {
        "parser": "bin/babel-parser.js"
      },
      "engines": {
        "node": ">=6.0.0"
      }
    },
    "node_modules/@babel/plugin-transform-react-jsx-self": {
      "version": "7.27.1",
      "resolved": "https://registry.npmjs.org/@babel/plugin-transform-react-jsx-self/-/plugin-transform-react-jsx-self-7.27.1.tgz",
      "integrity": "sha512-6UzkCs+ejGdZ5mFFC/OCUrv028ab2fp1znZmCZjAOBKiBK2jXD1O+BPSfX8X2qjJ75fZBMSnQn3Rq2mrBJK2mw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.27.1"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/plugin-transform-react-jsx-source": {
      "version": "7.27.1",
      "resolved": "https://registry.npmjs.org/@babel/plugin-transform-react-jsx-source/-/plugin-transform-react-jsx-source-7.27.1.tgz",
      "integrity": "sha512-zbwoTsBruTeKB9hSq73ha66iFeJHuaFkUbwvqElnygoNbj/jHRsSeokowZFN3CZ64IvEqcmmkVe89OPXc7ldAw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-plugin-utils": "^7.27.1"
      },
      "engines": {
        "node": ">=6.9.0"
      },
      "peerDependencies": {
        "@babel/core": "^7.0.0-0"
      }
    },
    "node_modules/@babel/template": {
      "version": "7.27.2",
      "resolved": "https://registry.npmjs.org/@babel/template/-/template-7.27.2.tgz",
      "integrity": "sha512-LPDZ85aEJyYSd18/DkjNh4/y1ntkE5KwUHWTiqgRxruuZL2F1yuHligVHLvcHY2vMHXttKFpJn6LwfI7cw7ODw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/code-frame": "^7.27.1",
        "@babel/parser": "^7.27.2",
        "@babel/types": "^7.27.1"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/traverse": {
      "version": "7.27.4",
      "resolved": "https://registry.npmjs.org/@babel/traverse/-/traverse-7.27.4.tgz",
      "integrity": "sha512-oNcu2QbHqts9BtOWJosOVJapWjBDSxGCpFvikNR5TGDYDQf3JwpIoMzIKrvfoti93cLfPJEG4tH9SPVeyCGgdA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/code-frame": "^7.27.1",
        "@babel/generator": "^7.27.3",
        "@babel/parser": "^7.27.4",
        "@babel/template": "^7.27.2",
        "@babel/types": "^7.27.3",
        "debug": "^4.3.1",
        "globals": "^11.1.0"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/traverse/node_modules/globals": {
      "version": "11.12.0",
      "resolved": "https://registry.npmjs.org/globals/-/globals-11.12.0.tgz",
      "integrity": "sha512-WOBp/EEGUiIsJSp7wcv/y6MO+lV9UoncWqxuFfm8eBwzWNgyfBd6Gz+IeKQ9jCmyhoH99g15M3T+QaVHFjizVA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=4"
      }
    },
    "node_modules/@babel/types": {
      "version": "7.27.6",
      "resolved": "https://registry.npmjs.org/@babel/types/-/types-7.27.6.tgz",
      "integrity": "sha512-ETyHEk2VHHvl9b9jZP5IHPavHYk57EhanlRRuae9XCpb/j5bDCbPPMOBfCWhnl/7EDJz0jEMCi/RhccCE8r1+Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/helper-string-parser": "^7.27.1",
        "@babel/helper-validator-identifier": "^7.27.1"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@esbuild/aix-ppc64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/aix-ppc64/-/aix-ppc64-0.25.5.tgz",
      "integrity": "sha512-9o3TMmpmftaCMepOdA5k/yDw8SfInyzWWTjYTFCX3kPSDJMROQTb8jg+h9Cnwnmm1vOzvxN7gIfB5V2ewpjtGA==",
      "cpu": [
        "ppc64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "aix"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/android-arm": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/android-arm/-/android-arm-0.25.5.tgz",
      "integrity": "sha512-AdJKSPeEHgi7/ZhuIPtcQKr5RQdo6OO2IL87JkianiMYMPbCtot9fxPbrMiBADOWWm3T2si9stAiVsGbTQFkbA==",
      "cpu": [
        "arm"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/android-arm64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/android-arm64/-/android-arm64-0.25.5.tgz",
      "integrity": "sha512-VGzGhj4lJO+TVGV1v8ntCZWJktV7SGCs3Pn1GRWI1SBFtRALoomm8k5E9Pmwg3HOAal2VDc2F9+PM/rEY6oIDg==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/android-x64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/android-x64/-/android-x64-0.25.5.tgz",
      "integrity": "sha512-D2GyJT1kjvO//drbRT3Hib9XPwQeWd9vZoBJn+bu/lVsOZ13cqNdDeqIF/xQ5/VmWvMduP6AmXvylO/PIc2isw==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/darwin-arm64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/darwin-arm64/-/darwin-arm64-0.25.5.tgz",
      "integrity": "sha512-GtaBgammVvdF7aPIgH2jxMDdivezgFu6iKpmT+48+F8Hhg5J/sfnDieg0aeG/jfSvkYQU2/pceFPDKlqZzwnfQ==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/darwin-x64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/darwin-x64/-/darwin-x64-0.25.5.tgz",
      "integrity": "sha512-1iT4FVL0dJ76/q1wd7XDsXrSW+oLoquptvh4CLR4kITDtqi2e/xwXwdCVH8hVHU43wgJdsq7Gxuzcs6Iq/7bxQ==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/freebsd-arm64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/freebsd-arm64/-/freebsd-arm64-0.25.5.tgz",
      "integrity": "sha512-nk4tGP3JThz4La38Uy/gzyXtpkPW8zSAmoUhK9xKKXdBCzKODMc2adkB2+8om9BDYugz+uGV7sLmpTYzvmz6Sw==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/freebsd-x64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/freebsd-x64/-/freebsd-x64-0.25.5.tgz",
      "integrity": "sha512-PrikaNjiXdR2laW6OIjlbeuCPrPaAl0IwPIaRv+SMV8CiM8i2LqVUHFC1+8eORgWyY7yhQY+2U2fA55mBzReaw==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-arm": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-arm/-/linux-arm-0.25.5.tgz",
      "integrity": "sha512-cPzojwW2okgh7ZlRpcBEtsX7WBuqbLrNXqLU89GxWbNt6uIg78ET82qifUy3W6OVww6ZWobWub5oqZOVtwolfw==",
      "cpu": [
        "arm"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-arm64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-arm64/-/linux-arm64-0.25.5.tgz",
      "integrity": "sha512-Z9kfb1v6ZlGbWj8EJk9T6czVEjjq2ntSYLY2cw6pAZl4oKtfgQuS4HOq41M/BcoLPzrUbNd+R4BXFyH//nHxVg==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-ia32": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-ia32/-/linux-ia32-0.25.5.tgz",
      "integrity": "sha512-sQ7l00M8bSv36GLV95BVAdhJ2QsIbCuCjh/uYrWiMQSUuV+LpXwIqhgJDcvMTj+VsQmqAHL2yYaasENvJ7CDKA==",
      "cpu": [
        "ia32"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-loong64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-loong64/-/linux-loong64-0.25.5.tgz",
      "integrity": "sha512-0ur7ae16hDUC4OL5iEnDb0tZHDxYmuQyhKhsPBV8f99f6Z9KQM02g33f93rNH5A30agMS46u2HP6qTdEt6Q1kg==",
      "cpu": [
        "loong64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-mips64el": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-mips64el/-/linux-mips64el-0.25.5.tgz",
      "integrity": "sha512-kB/66P1OsHO5zLz0i6X0RxlQ+3cu0mkxS3TKFvkb5lin6uwZ/ttOkP3Z8lfR9mJOBk14ZwZ9182SIIWFGNmqmg==",
      "cpu": [
        "mips64el"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-ppc64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-ppc64/-/linux-ppc64-0.25.5.tgz",
      "integrity": "sha512-UZCmJ7r9X2fe2D6jBmkLBMQetXPXIsZjQJCjgwpVDz+YMcS6oFR27alkgGv3Oqkv07bxdvw7fyB71/olceJhkQ==",
      "cpu": [
        "ppc64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-riscv64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-riscv64/-/linux-riscv64-0.25.5.tgz",
      "integrity": "sha512-kTxwu4mLyeOlsVIFPfQo+fQJAV9mh24xL+y+Bm6ej067sYANjyEw1dNHmvoqxJUCMnkBdKpvOn0Ahql6+4VyeA==",
      "cpu": [
        "riscv64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-s390x": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-s390x/-/linux-s390x-0.25.5.tgz",
      "integrity": "sha512-K2dSKTKfmdh78uJ3NcWFiqyRrimfdinS5ErLSn3vluHNeHVnBAFWC8a4X5N+7FgVE1EjXS1QDZbpqZBjfrqMTQ==",
      "cpu": [
        "s390x"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-x64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-x64/-/linux-x64-0.25.5.tgz",
      "integrity": "sha512-uhj8N2obKTE6pSZ+aMUbqq+1nXxNjZIIjCjGLfsWvVpy7gKCOL6rsY1MhRh9zLtUtAI7vpgLMK6DxjO8Qm9lJw==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/netbsd-arm64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/netbsd-arm64/-/netbsd-arm64-0.25.5.tgz",
      "integrity": "sha512-pwHtMP9viAy1oHPvgxtOv+OkduK5ugofNTVDilIzBLpoWAM16r7b/mxBvfpuQDpRQFMfuVr5aLcn4yveGvBZvw==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "netbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/netbsd-x64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/netbsd-x64/-/netbsd-x64-0.25.5.tgz",
      "integrity": "sha512-WOb5fKrvVTRMfWFNCroYWWklbnXH0Q5rZppjq0vQIdlsQKuw6mdSihwSo4RV/YdQ5UCKKvBy7/0ZZYLBZKIbwQ==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "netbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/openbsd-arm64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/openbsd-arm64/-/openbsd-arm64-0.25.5.tgz",
      "integrity": "sha512-7A208+uQKgTxHd0G0uqZO8UjK2R0DDb4fDmERtARjSHWxqMTye4Erz4zZafx7Di9Cv+lNHYuncAkiGFySoD+Mw==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "openbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/openbsd-x64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/openbsd-x64/-/openbsd-x64-0.25.5.tgz",
      "integrity": "sha512-G4hE405ErTWraiZ8UiSoesH8DaCsMm0Cay4fsFWOOUcz8b8rC6uCvnagr+gnioEjWn0wC+o1/TAHt+It+MpIMg==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "openbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/sunos-x64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/sunos-x64/-/sunos-x64-0.25.5.tgz",
      "integrity": "sha512-l+azKShMy7FxzY0Rj4RCt5VD/q8mG/e+mDivgspo+yL8zW7qEwctQ6YqKX34DTEleFAvCIUviCFX1SDZRSyMQA==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "sunos"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/win32-arm64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/win32-arm64/-/win32-arm64-0.25.5.tgz",
      "integrity": "sha512-O2S7SNZzdcFG7eFKgvwUEZ2VG9D/sn/eIiz8XRZ1Q/DO5a3s76Xv0mdBzVM5j5R639lXQmPmSo0iRpHqUUrsxw==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/win32-ia32": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/win32-ia32/-/win32-ia32-0.25.5.tgz",
      "integrity": "sha512-onOJ02pqs9h1iMJ1PQphR+VZv8qBMQ77Klcsqv9CNW2w6yLqoURLcgERAIurY6QE63bbLuqgP9ATqajFLK5AMQ==",
      "cpu": [
        "ia32"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/win32-x64": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-0.25.5.tgz",
      "integrity": "sha512-TXv6YnJ8ZMVdX+SXWVBo/0p8LTcrUYngpWjvm91TMjjBQii7Oz11Lw5lbDV5Y0TzuhSJHwiH4hEtC1I42mMS0g==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@eslint-community/eslint-utils": {
      "version": "4.7.0",
      "resolved": "https://registry.npmjs.org/@eslint-community/eslint-utils/-/eslint-utils-4.7.0.tgz",
      "integrity": "sha512-dyybb3AcajC7uha6CvhdVRJqaKyn7w2YKqKyAN37NKYgZT36w+iRb0Dymmc5qEJ549c/S31cMMSFd75bteCpCw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "eslint-visitor-keys": "^3.4.3"
      },
      "engines": {
        "node": "^12.22.0 || ^14.17.0 || >=16.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/eslint"
      },
      "peerDependencies": {
        "eslint": "^6.0.0 || ^7.0.0 || >=8.0.0"
      }
    },
    "node_modules/@eslint-community/eslint-utils/node_modules/eslint-visitor-keys": {
      "version": "3.4.3",
      "resolved": "https://registry.npmjs.org/eslint-visitor-keys/-/eslint-visitor-keys-3.4.3.tgz",
      "integrity": "sha512-wpc+LXeiyiisxPlEkUzU6svyS1frIO3Mgxj1fdy7Pm8Ygzguax2N3Fa/D/ag1WqbOprdI+uY6wMUl8/a2G+iag==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": "^12.22.0 || ^14.17.0 || >=16.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/eslint"
      }
    },
    "node_modules/@eslint-community/regexpp": {
      "version": "4.12.1",
      "resolved": "https://registry.npmjs.org/@eslint-community/regexpp/-/regexpp-4.12.1.tgz",
      "integrity": "sha512-CCZCDJuduB9OUkFkY2IgppNZMi2lBQgD2qzwXkEia16cge2pijY/aXi96CJMquDMn3nJdlPV1A5KrJEXwfLNzQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "^12.0.0 || ^14.0.0 || >=16.0.0"
      }
    },
    "node_modules/@eslint/config-array": {
      "version": "0.20.1",
      "resolved": "https://registry.npmjs.org/@eslint/config-array/-/config-array-0.20.1.tgz",
      "integrity": "sha512-OL0RJzC/CBzli0DrrR31qzj6d6i6Mm3HByuhflhl4LOBiWxN+3i6/t/ZQQNii4tjksXi8r2CRW1wMpWA2ULUEw==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@eslint/object-schema": "^2.1.6",
        "debug": "^4.3.1",
        "minimatch": "^3.1.2"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      }
    },
    "node_modules/@eslint/config-helpers": {
      "version": "0.2.3",
      "resolved": "https://registry.npmjs.org/@eslint/config-helpers/-/config-helpers-0.2.3.tgz",
      "integrity": "sha512-u180qk2Um1le4yf0ruXH3PYFeEZeYC3p/4wCTKrr2U1CmGdzGi3KtY0nuPDH48UJxlKCC5RDzbcbh4X0XlqgHg==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      }
    },
    "node_modules/@eslint/core": {
      "version": "0.14.0",
      "resolved": "https://registry.npmjs.org/@eslint/core/-/core-0.14.0.tgz",
      "integrity": "sha512-qIbV0/JZr7iSDjqAc60IqbLdsj9GDt16xQtWD+B78d/HAlvysGdZZ6rpJHGAc2T0FQx1X6thsSPdnoiGKdNtdg==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@types/json-schema": "^7.0.15"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      }
    },
    "node_modules/@eslint/eslintrc": {
      "version": "3.3.1",
      "resolved": "https://registry.npmjs.org/@eslint/eslintrc/-/eslintrc-3.3.1.tgz",
      "integrity": "sha512-gtF186CXhIl1p4pJNGZw8Yc6RlshoePRvE0X91oPGb3vZ8pM3qOS9W9NGPat9LziaBV7XrJWGylNQXkGcnM3IQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "ajv": "^6.12.4",
        "debug": "^4.3.2",
        "espree": "^10.0.1",
        "globals": "^14.0.0",
        "ignore": "^5.2.0",
        "import-fresh": "^3.2.1",
        "js-yaml": "^4.1.0",
        "minimatch": "^3.1.2",
        "strip-json-comments": "^3.1.1"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "url": "https://opencollective.com/eslint"
      }
    },
    "node_modules/@eslint/eslintrc/node_modules/globals": {
      "version": "14.0.0",
      "resolved": "https://registry.npmjs.org/globals/-/globals-14.0.0.tgz",
      "integrity": "sha512-oahGvuMGQlPw/ivIYBjVSrWAfWLBeku5tpPE2fOPLi+WHffIWbuh2tCjhyQhTBPMf5E9jDEH4FOmTYgYwbKwtQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=18"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/@eslint/js": {
      "version": "9.29.0",
      "resolved": "https://registry.npmjs.org/@eslint/js/-/js-9.29.0.tgz",
      "integrity": "sha512-3PIF4cBw/y+1u2EazflInpV+lYsSG0aByVIQzAgb1m1MhHFSbqTyNqtBKHgWf/9Ykud+DhILS9EGkmekVhbKoQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "url": "https://eslint.org/donate"
      }
    },
    "node_modules/@eslint/object-schema": {
      "version": "2.1.6",
      "resolved": "https://registry.npmjs.org/@eslint/object-schema/-/object-schema-2.1.6.tgz",
      "integrity": "sha512-RBMg5FRL0I0gs51M/guSAj5/e14VQ4tpZnQNWwuDT66P14I43ItmPfIZRhO9fUVIPOAQXU47atlywZ/czoqFPA==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      }
    },
    "node_modules/@eslint/plugin-kit": {
      "version": "0.3.2",
      "resolved": "https://registry.npmjs.org/@eslint/plugin-kit/-/plugin-kit-0.3.2.tgz",
      "integrity": "sha512-4SaFZCNfJqvk/kenHpI8xvN42DMaoycy4PzKc5otHxRswww1kAt82OlBuwRVLofCACCTZEcla2Ydxv8scMXaTg==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@eslint/core": "^0.15.0",
        "levn": "^0.4.1"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      }
    },
    "node_modules/@eslint/plugin-kit/node_modules/@eslint/core": {
      "version": "0.15.0",
      "resolved": "https://registry.npmjs.org/@eslint/core/-/core-0.15.0.tgz",
      "integrity": "sha512-b7ePw78tEWWkpgZCDYkbqDOP8dmM6qe+AOC6iuJqlq1R/0ahMAeH3qynpnqKFGkMltrp44ohV4ubGyvLX28tzw==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@types/json-schema": "^7.0.15"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      }
    },
    "node_modules/@humanfs/core": {
      "version": "0.19.1",
      "resolved": "https://registry.npmjs.org/@humanfs/core/-/core-0.19.1.tgz",
      "integrity": "sha512-5DyQ4+1JEUzejeK1JGICcideyfUbGixgS9jNgex5nqkW+cY7WZhxBigmieN5Qnw9ZosSNVC9KQKyb+GUaGyKUA==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": ">=18.18.0"
      }
    },
    "node_modules/@humanfs/node": {
      "version": "0.16.6",
      "resolved": "https://registry.npmjs.org/@humanfs/node/-/node-0.16.6.tgz",
      "integrity": "sha512-YuI2ZHQL78Q5HbhDiBA1X4LmYdXCKCMQIfw0pw7piHJwyREFebJUvrQN4cMssyES6x+vfUbx1CIpaQUKYdQZOw==",
      "dev": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@humanfs/core": "^0.19.1",
        "@humanwhocodes/retry": "^0.3.0"
      },
      "engines": {
        "node": ">=18.18.0"
      }
    },
    "node_modules/@humanfs/node/node_modules/@humanwhocodes/retry": {
      "version": "0.3.1",
      "resolved": "https://registry.npmjs.org/@humanwhocodes/retry/-/retry-0.3.1.tgz",
      "integrity": "sha512-JBxkERygn7Bv/GbN5Rv8Ul6LVknS+5Bp6RgDC/O8gEBU/yeH5Ui5C/OlWrTb6qct7LjjfT6Re2NxB0ln0yYybA==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": ">=18.18"
      },
      "funding": {
        "type": "github",
        "url": "https://github.com/sponsors/nzakas"
      }
    },
    "node_modules/@humanwhocodes/module-importer": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/@humanwhocodes/module-importer/-/module-importer-1.0.1.tgz",
      "integrity": "sha512-bxveV4V8v5Yb4ncFTT3rPSgZBOpCkjfK0y4oVVVJwIuDVBRMDXrPyXRL988i5ap9m9bnyEEjWfm5WkBmtffLfA==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": ">=12.22"
      },
      "funding": {
        "type": "github",
        "url": "https://github.com/sponsors/nzakas"
      }
    },
    "node_modules/@humanwhocodes/retry": {
      "version": "0.4.3",
      "resolved": "https://registry.npmjs.org/@humanwhocodes/retry/-/retry-0.4.3.tgz",
      "integrity": "sha512-bV0Tgo9K4hfPCek+aMAn81RppFKv2ySDQeMoSZuvTASywNTnVJCArCZE2FWqpvIatKu7VMRLWlR1EazvVhDyhQ==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": ">=18.18"
      },
      "funding": {
        "type": "github",
        "url": "https://github.com/sponsors/nzakas"
      }
    },
    "node_modules/@isaacs/fs-minipass": {
      "version": "4.0.1",
      "resolved": "https://registry.npmjs.org/@isaacs/fs-minipass/-/fs-minipass-4.0.1.tgz",
      "integrity": "sha512-wgm9Ehl2jpeqP3zw/7mo3kRHFp5MEDhqAdwy1fTGkHAwnkGOVsgpvQhL8B5n1qlb01jV3n/bI0ZfZp5lWA1k4w==",
      "license": "ISC",
      "dependencies": {
        "minipass": "^7.0.4"
      },
      "engines": {
        "node": ">=18.0.0"
      }
    },
    "node_modules/@jridgewell/gen-mapping": {
      "version": "0.3.8",
      "resolved": "https://registry.npmjs.org/@jridgewell/gen-mapping/-/gen-mapping-0.3.8.tgz",
      "integrity": "sha512-imAbBGkb+ebQyxKgzv5Hu2nmROxoDOXHh80evxdoXNOrvAnVx7zimzc1Oo5h9RlfV4vPXaE2iM5pOFbvOCClWA==",
      "license": "MIT",
      "dependencies": {
        "@jridgewell/set-array": "^1.2.1",
        "@jridgewell/sourcemap-codec": "^1.4.10",
        "@jridgewell/trace-mapping": "^0.3.24"
      },
      "engines": {
        "node": ">=6.0.0"
      }
    },
    "node_modules/@jridgewell/remapping": {
      "version": "2.3.5",
      "resolved": "https://registry.npmjs.org/@jridgewell/remapping/-/remapping-2.3.5.tgz",
      "integrity": "sha512-LI9u/+laYG4Ds1TDKSJW2YPrIlcVYOwi2fUC6xB43lueCjgxV4lffOCZCtYFiH6TNOX+tQKXx97T4IKHbhyHEQ==",
      "license": "MIT",
      "dependencies": {
        "@jridgewell/gen-mapping": "^0.3.5",
        "@jridgewell/trace-mapping": "^0.3.24"
      }
    },
    "node_modules/@jridgewell/resolve-uri": {
      "version": "3.1.2",
      "resolved": "https://registry.npmjs.org/@jridgewell/resolve-uri/-/resolve-uri-3.1.2.tgz",
      "integrity": "sha512-bRISgCIjP20/tbWSPWMEi54QVPRZExkuD9lJL+UIxUKtwVJA8wW1Trb1jMs1RFXo1CBTNZ/5hpC9QvmKWdopKw==",
      "license": "MIT",
      "engines": {
        "node": ">=6.0.0"
      }
    },
    "node_modules/@jridgewell/set-array": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/@jridgewell/set-array/-/set-array-1.2.1.tgz",
      "integrity": "sha512-R8gLRTZeyp03ymzP/6Lil/28tGeGEzhx1q2k703KGWRAI1VdvPIXdG70VJc2pAMw3NA6JKL5hhFu1sJX0Mnn/A==",
      "license": "MIT",
      "engines": {
        "node": ">=6.0.0"
      }
    },
    "node_modules/@jridgewell/sourcemap-codec": {
      "version": "1.5.5",
      "resolved": "https://registry.npmjs.org/@jridgewell/sourcemap-codec/-/sourcemap-codec-1.5.5.tgz",
      "integrity": "sha512-cYQ9310grqxueWbl+WuIUIaiUaDcj7WOq5fVhEljNVgRfOUhY9fy2zTvfoqWsnebh8Sl70VScFbICvJnLKB0Og==",
      "license": "MIT"
    },
    "node_modules/@jridgewell/trace-mapping": {
      "version": "0.3.25",
      "resolved": "https://registry.npmjs.org/@jridgewell/trace-mapping/-/trace-mapping-0.3.25.tgz",
      "integrity": "sha512-vNk6aEwybGtawWmy/PzwnGDOjCkLWSD2wqvjGGAgOAwCGWySYXfYoxt00IJkTF+8Lb57DwOb3Aa0o9CApepiYQ==",
      "license": "MIT",
      "dependencies": {
        "@jridgewell/resolve-uri": "^3.1.0",
        "@jridgewell/sourcemap-codec": "^1.4.14"
      }
    },
    "node_modules/@nodelib/fs.scandir": {
      "version": "2.1.5",
      "resolved": "https://registry.npmjs.org/@nodelib/fs.scandir/-/fs.scandir-2.1.5.tgz",
      "integrity": "sha512-vq24Bq3ym5HEQm2NKCr3yXDwjc7vTsEThRDnkp2DK9p1uqLR+DHurm/NOTo0KG7HYHU7eppKZj3MyqYuMBf62g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@nodelib/fs.stat": "2.0.5",
        "run-parallel": "^1.1.9"
      },
      "engines": {
        "node": ">= 8"
      }
    },
    "node_modules/@nodelib/fs.stat": {
      "version": "2.0.5",
      "resolved": "https://registry.npmjs.org/@nodelib/fs.stat/-/fs.stat-2.0.5.tgz",
      "integrity": "sha512-RkhPPp2zrqDAQA/2jNhnztcPAlv64XdhIp7a7454A5ovI7Bukxgt7MX7udwAu3zg1DcpPU0rz3VV1SeaqvY4+A==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 8"
      }
    },
    "node_modules/@nodelib/fs.walk": {
      "version": "1.2.8",
      "resolved": "https://registry.npmjs.org/@nodelib/fs.walk/-/fs.walk-1.2.8.tgz",
      "integrity": "sha512-oGB+UxlgWcgQkgwo8GcEGwemoTFt3FIO9ababBmaGwXIoBKZ+GTy0pP185beGg7Llih/NSHSV2XAs1lnznocSg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@nodelib/fs.scandir": "2.1.5",
        "fastq": "^1.6.0"
      },
      "engines": {
        "node": ">= 8"
      }
    },
    "node_modules/@remix-run/router": {
      "version": "1.23.0",
      "resolved": "https://registry.npmjs.org/@remix-run/router/-/router-1.23.0.tgz",
      "integrity": "sha512-O3rHJzAQKamUz1fvE0Qaw0xSFqsA/yafi2iqeE0pvdFtCO1viYx8QL6f3Ln/aCCTLxs68SLf0KPM9eSeM8yBnA==",
      "license": "MIT",
      "engines": {
        "node": ">=14.0.0"
      }
    },
    "node_modules/@rolldown/pluginutils": {
      "version": "1.0.0-beta.19",
      "resolved": "https://registry.npmjs.org/@rolldown/pluginutils/-/pluginutils-1.0.0-beta.19.tgz",
      "integrity": "sha512-3FL3mnMbPu0muGOCaKAhhFEYmqv9eTfPSJRJmANrCwtgK8VuxpsZDGK+m0LYAGoyO8+0j5uRe4PeyPDK1yA/hA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@rollup/rollup-android-arm-eabi": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-android-arm-eabi/-/rollup-android-arm-eabi-4.44.0.tgz",
      "integrity": "sha512-xEiEE5oDW6tK4jXCAyliuntGR+amEMO7HLtdSshVuhFnKTYoeYMyXQK7pLouAJJj5KHdwdn87bfHAR2nSdNAUA==",
      "cpu": [
        "arm"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ]
    },
    "node_modules/@rollup/rollup-android-arm64": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-android-arm64/-/rollup-android-arm64-4.44.0.tgz",
      "integrity": "sha512-uNSk/TgvMbskcHxXYHzqwiyBlJ/lGcv8DaUfcnNwict8ba9GTTNxfn3/FAoFZYgkaXXAdrAA+SLyKplyi349Jw==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ]
    },
    "node_modules/@rollup/rollup-darwin-arm64": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-darwin-arm64/-/rollup-darwin-arm64-4.44.0.tgz",
      "integrity": "sha512-VGF3wy0Eq1gcEIkSCr8Ke03CWT+Pm2yveKLaDvq51pPpZza3JX/ClxXOCmTYYq3us5MvEuNRTaeyFThCKRQhOA==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ]
    },
    "node_modules/@rollup/rollup-darwin-x64": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-darwin-x64/-/rollup-darwin-x64-4.44.0.tgz",
      "integrity": "sha512-fBkyrDhwquRvrTxSGH/qqt3/T0w5Rg0L7ZIDypvBPc1/gzjJle6acCpZ36blwuwcKD/u6oCE/sRWlUAcxLWQbQ==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ]
    },
    "node_modules/@rollup/rollup-freebsd-arm64": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-freebsd-arm64/-/rollup-freebsd-arm64-4.44.0.tgz",
      "integrity": "sha512-u5AZzdQJYJXByB8giQ+r4VyfZP+walV+xHWdaFx/1VxsOn6eWJhK2Vl2eElvDJFKQBo/hcYIBg/jaKS8ZmKeNQ==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ]
    },
    "node_modules/@rollup/rollup-freebsd-x64": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-freebsd-x64/-/rollup-freebsd-x64-4.44.0.tgz",
      "integrity": "sha512-qC0kS48c/s3EtdArkimctY7h3nHicQeEUdjJzYVJYR3ct3kWSafmn6jkNCA8InbUdge6PVx6keqjk5lVGJf99g==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ]
    },
    "node_modules/@rollup/rollup-linux-arm-gnueabihf": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm-gnueabihf/-/rollup-linux-arm-gnueabihf-4.44.0.tgz",
      "integrity": "sha512-x+e/Z9H0RAWckn4V2OZZl6EmV0L2diuX3QB0uM1r6BvhUIv6xBPL5mrAX2E3e8N8rEHVPwFfz/ETUbV4oW9+lQ==",
      "cpu": [
        "arm"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-arm-musleabihf": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm-musleabihf/-/rollup-linux-arm-musleabihf-4.44.0.tgz",
      "integrity": "sha512-1exwiBFf4PU/8HvI8s80icyCcnAIB86MCBdst51fwFmH5dyeoWVPVgmQPcKrMtBQ0W5pAs7jBCWuRXgEpRzSCg==",
      "cpu": [
        "arm"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-arm64-gnu": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm64-gnu/-/rollup-linux-arm64-gnu-4.44.0.tgz",
      "integrity": "sha512-ZTR2mxBHb4tK4wGf9b8SYg0Y6KQPjGpR4UWwTFdnmjB4qRtoATZ5dWn3KsDwGa5Z2ZBOE7K52L36J9LueKBdOQ==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-arm64-musl": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm64-musl/-/rollup-linux-arm64-musl-4.44.0.tgz",
      "integrity": "sha512-GFWfAhVhWGd4r6UxmnKRTBwP1qmModHtd5gkraeW2G490BpFOZkFtem8yuX2NyafIP/mGpRJgTJ2PwohQkUY/Q==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-loongarch64-gnu": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-loongarch64-gnu/-/rollup-linux-loongarch64-gnu-4.44.0.tgz",
      "integrity": "sha512-xw+FTGcov/ejdusVOqKgMGW3c4+AgqrfvzWEVXcNP6zq2ue+lsYUgJ+5Rtn/OTJf7e2CbgTFvzLW2j0YAtj0Gg==",
      "cpu": [
        "loong64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-powerpc64le-gnu": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-powerpc64le-gnu/-/rollup-linux-powerpc64le-gnu-4.44.0.tgz",
      "integrity": "sha512-bKGibTr9IdF0zr21kMvkZT4K6NV+jjRnBoVMt2uNMG0BYWm3qOVmYnXKzx7UhwrviKnmK46IKMByMgvpdQlyJQ==",
      "cpu": [
        "ppc64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-riscv64-gnu": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-riscv64-gnu/-/rollup-linux-riscv64-gnu-4.44.0.tgz",
      "integrity": "sha512-vV3cL48U5kDaKZtXrti12YRa7TyxgKAIDoYdqSIOMOFBXqFj2XbChHAtXquEn2+n78ciFgr4KIqEbydEGPxXgA==",
      "cpu": [
        "riscv64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-riscv64-musl": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-riscv64-musl/-/rollup-linux-riscv64-musl-4.44.0.tgz",
      "integrity": "sha512-TDKO8KlHJuvTEdfw5YYFBjhFts2TR0VpZsnLLSYmB7AaohJhM8ctDSdDnUGq77hUh4m/djRafw+9zQpkOanE2Q==",
      "cpu": [
        "riscv64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-s390x-gnu": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-s390x-gnu/-/rollup-linux-s390x-gnu-4.44.0.tgz",
      "integrity": "sha512-8541GEyktXaw4lvnGp9m84KENcxInhAt6vPWJ9RodsB/iGjHoMB2Pp5MVBCiKIRxrxzJhGCxmNzdu+oDQ7kwRA==",
      "cpu": [
        "s390x"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-x64-gnu": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-x64-gnu/-/rollup-linux-x64-gnu-4.44.0.tgz",
      "integrity": "sha512-iUVJc3c0o8l9Sa/qlDL2Z9UP92UZZW1+EmQ4xfjTc1akr0iUFZNfxrXJ/R1T90h/ILm9iXEY6+iPrmYB3pXKjw==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-x64-musl": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-x64-musl/-/rollup-linux-x64-musl-4.44.0.tgz",
      "integrity": "sha512-PQUobbhLTQT5yz/SPg116VJBgz+XOtXt8D1ck+sfJJhuEsMj2jSej5yTdp8CvWBSceu+WW+ibVL6dm0ptG5fcA==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-win32-arm64-msvc": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-arm64-msvc/-/rollup-win32-arm64-msvc-4.44.0.tgz",
      "integrity": "sha512-M0CpcHf8TWn+4oTxJfh7LQuTuaYeXGbk0eageVjQCKzYLsajWS/lFC94qlRqOlyC2KvRT90ZrfXULYmukeIy7w==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ]
    },
    "node_modules/@rollup/rollup-win32-ia32-msvc": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-ia32-msvc/-/rollup-win32-ia32-msvc-4.44.0.tgz",
      "integrity": "sha512-3XJ0NQtMAXTWFW8FqZKcw3gOQwBtVWP/u8TpHP3CRPXD7Pd6s8lLdH3sHWh8vqKCyyiI8xW5ltJScQmBU9j7WA==",
      "cpu": [
        "ia32"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ]
    },
    "node_modules/@rollup/rollup-win32-x64-msvc": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-x64-msvc/-/rollup-win32-x64-msvc-4.44.0.tgz",
      "integrity": "sha512-Q2Mgwt+D8hd5FIPUuPDsvPR7Bguza6yTkJxspDGkZj7tBRn2y4KSWYuIXpftFSjBra76TbKerCV7rgFPQrn+wQ==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ]
    },
    "node_modules/@tailwindcss/node": {
      "version": "4.1.13",
      "resolved": "https://registry.npmjs.org/@tailwindcss/node/-/node-4.1.13.tgz",
      "integrity": "sha512-eq3ouolC1oEFOAvOMOBAmfCIqZBJuvWvvYWh5h5iOYfe1HFC6+GZ6EIL0JdM3/niGRJmnrOc+8gl9/HGUaaptw==",
      "license": "MIT",
      "dependencies": {
        "@jridgewell/remapping": "^2.3.4",
        "enhanced-resolve": "^5.18.3",
        "jiti": "^2.5.1",
        "lightningcss": "1.30.1",
        "magic-string": "^0.30.18",
        "source-map-js": "^1.2.1",
        "tailwindcss": "4.1.13"
      }
    },
    "node_modules/@tailwindcss/oxide": {
      "version": "4.1.13",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide/-/oxide-4.1.13.tgz",
      "integrity": "sha512-CPgsM1IpGRa880sMbYmG1s4xhAy3xEt1QULgTJGQmZUeNgXFR7s1YxYygmJyBGtou4SyEosGAGEeYqY7R53bIA==",
      "hasInstallScript": true,
      "license": "MIT",
      "dependencies": {
        "detect-libc": "^2.0.4",
        "tar": "^7.4.3"
      },
      "engines": {
        "node": ">= 10"
      },
      "optionalDependencies": {
        "@tailwindcss/oxide-android-arm64": "4.1.13",
        "@tailwindcss/oxide-darwin-arm64": "4.1.13",
        "@tailwindcss/oxide-darwin-x64": "4.1.13",
        "@tailwindcss/oxide-freebsd-x64": "4.1.13",
        "@tailwindcss/oxide-linux-arm-gnueabihf": "4.1.13",
        "@tailwindcss/oxide-linux-arm64-gnu": "4.1.13",
        "@tailwindcss/oxide-linux-arm64-musl": "4.1.13",
        "@tailwindcss/oxide-linux-x64-gnu": "4.1.13",
        "@tailwindcss/oxide-linux-x64-musl": "4.1.13",
        "@tailwindcss/oxide-wasm32-wasi": "4.1.13",
        "@tailwindcss/oxide-win32-arm64-msvc": "4.1.13",
        "@tailwindcss/oxide-win32-x64-msvc": "4.1.13"
      }
    },
    "node_modules/@tailwindcss/oxide-android-arm64": {
      "version": "4.1.13",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-android-arm64/-/oxide-android-arm64-4.1.13.tgz",
      "integrity": "sha512-BrpTrVYyejbgGo57yc8ieE+D6VT9GOgnNdmh5Sac6+t0m+v+sKQevpFVpwX3pBrM2qKrQwJ0c5eDbtjouY/+ew==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tailwindcss/oxide-darwin-arm64": {
      "version": "4.1.13",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-darwin-arm64/-/oxide-darwin-arm64-4.1.13.tgz",
      "integrity": "sha512-YP+Jksc4U0KHcu76UhRDHq9bx4qtBftp9ShK/7UGfq0wpaP96YVnnjFnj3ZFrUAjc5iECzODl/Ts0AN7ZPOANQ==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tailwindcss/oxide-darwin-x64": {
      "version": "4.1.13",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-darwin-x64/-/oxide-darwin-x64-4.1.13.tgz",
      "integrity": "sha512-aAJ3bbwrn/PQHDxCto9sxwQfT30PzyYJFG0u/BWZGeVXi5Hx6uuUOQEI2Fa43qvmUjTRQNZnGqe9t0Zntexeuw==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tailwindcss/oxide-freebsd-x64": {
      "version": "4.1.13",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-freebsd-x64/-/oxide-freebsd-x64-4.1.13.tgz",
      "integrity": "sha512-Wt8KvASHwSXhKE/dJLCCWcTSVmBj3xhVhp/aF3RpAhGeZ3sVo7+NTfgiN8Vey/Fi8prRClDs6/f0KXPDTZE6nQ==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tailwindcss/oxide-linux-arm-gnueabihf": {
      "version": "4.1.13",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-linux-arm-gnueabihf/-/oxide-linux-arm-gnueabihf-4.1.13.tgz",
      "integrity": "sha512-mbVbcAsW3Gkm2MGwA93eLtWrwajz91aXZCNSkGTx/R5eb6KpKD5q8Ueckkh9YNboU8RH7jiv+ol/I7ZyQ9H7Bw==",
      "cpu": [
        "arm"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tailwindcss/oxide-linux-arm64-gnu": {
      "version": "4.1.13",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-linux-arm64-gnu/-/oxide-linux-arm64-gnu-4.1.13.tgz",
      "integrity": "sha512-wdtfkmpXiwej/yoAkrCP2DNzRXCALq9NVLgLELgLim1QpSfhQM5+ZxQQF8fkOiEpuNoKLp4nKZ6RC4kmeFH0HQ==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tailwindcss/oxide-linux-arm64-musl": {
      "version": "4.1.13",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-linux-arm64-musl/-/oxide-linux-arm64-musl-4.1.13.tgz",
      "integrity": "sha512-hZQrmtLdhyqzXHB7mkXfq0IYbxegaqTmfa1p9MBj72WPoDD3oNOh1Lnxf6xZLY9C3OV6qiCYkO1i/LrzEdW2mg==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tailwindcss/oxide-linux-x64-gnu": {
      "version": "4.1.13",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-linux-x64-gnu/-/oxide-linux-x64-gnu-4.1.13.tgz",
      "integrity": "sha512-uaZTYWxSXyMWDJZNY1Ul7XkJTCBRFZ5Fo6wtjrgBKzZLoJNrG+WderJwAjPzuNZOnmdrVg260DKwXCFtJ/hWRQ==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tailwindcss/oxide-linux-x64-musl": {
      "version": "4.1.13",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-linux-x64-musl/-/oxide-linux-x64-musl-4.1.13.tgz",
      "integrity": "sha512-oXiPj5mi4Hdn50v5RdnuuIms0PVPI/EG4fxAfFiIKQh5TgQgX7oSuDWntHW7WNIi/yVLAiS+CRGW4RkoGSSgVQ==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tailwindcss/oxide-wasm32-wasi": {
      "version": "4.1.13",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-wasm32-wasi/-/oxide-wasm32-wasi-4.1.13.tgz",
      "integrity": "sha512-+LC2nNtPovtrDwBc/nqnIKYh/W2+R69FA0hgoeOn64BdCX522u19ryLh3Vf3F8W49XBcMIxSe665kwy21FkhvA==",
      "bundleDependencies": [
        "@napi-rs/wasm-runtime",
        "@emnapi/core",
        "@emnapi/runtime",
        "@tybys/wasm-util",
        "@emnapi/wasi-threads",
        "tslib"
      ],
      "cpu": [
        "wasm32"
      ],
      "license": "MIT",
      "optional": true,
      "dependencies": {
        "@emnapi/core": "^1.4.5",
        "@emnapi/runtime": "^1.4.5",
        "@emnapi/wasi-threads": "^1.0.4",
        "@napi-rs/wasm-runtime": "^0.2.12",
        "@tybys/wasm-util": "^0.10.0",
        "tslib": "^2.8.0"
      },
      "engines": {
        "node": ">=14.0.0"
      }
    },
    "node_modules/@tailwindcss/oxide-win32-arm64-msvc": {
      "version": "4.1.13",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-win32-arm64-msvc/-/oxide-win32-arm64-msvc-4.1.13.tgz",
      "integrity": "sha512-dziTNeQXtoQ2KBXmrjCxsuPk3F3CQ/yb7ZNZNA+UkNTeiTGgfeh+gH5Pi7mRncVgcPD2xgHvkFCh/MhZWSgyQg==",
      "cpu": [
        "arm64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tailwindcss/oxide-win32-x64-msvc": {
      "version": "4.1.13",
      "resolved": "https://registry.npmjs.org/@tailwindcss/oxide-win32-x64-msvc/-/oxide-win32-x64-msvc-4.1.13.tgz",
      "integrity": "sha512-3+LKesjXydTkHk5zXX01b5KMzLV1xl2mcktBJkje7rhFUpUlYJy7IMOLqjIRQncLTa1WZZiFY/foAeB5nmaiTw==",
      "cpu": [
        "x64"
      ],
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/@tailwindcss/vite": {
      "version": "4.1.13",
      "resolved": "https://registry.npmjs.org/@tailwindcss/vite/-/vite-4.1.13.tgz",
      "integrity": "sha512-0PmqLQ010N58SbMTJ7BVJ4I2xopiQn/5i6nlb4JmxzQf8zcS5+m2Cv6tqh+sfDwtIdjoEnOvwsGQ1hkUi8QEHQ==",
      "license": "MIT",
      "dependencies": {
        "@tailwindcss/node": "4.1.13",
        "@tailwindcss/oxide": "4.1.13",
        "tailwindcss": "4.1.13"
      },
      "peerDependencies": {
        "vite": "^5.2.0 || ^6 || ^7"
      }
    },
    "node_modules/@types/babel__core": {
      "version": "7.20.5",
      "resolved": "https://registry.npmjs.org/@types/babel__core/-/babel__core-7.20.5.tgz",
      "integrity": "sha512-qoQprZvz5wQFJwMDqeseRXWv3rqMvhgpbXFfVyWhbx9X47POIA6i/+dXefEmZKoAgOaTdaIgNSMqMIU61yRyzA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/parser": "^7.20.7",
        "@babel/types": "^7.20.7",
        "@types/babel__generator": "*",
        "@types/babel__template": "*",
        "@types/babel__traverse": "*"
      }
    },
    "node_modules/@types/babel__generator": {
      "version": "7.27.0",
      "resolved": "https://registry.npmjs.org/@types/babel__generator/-/babel__generator-7.27.0.tgz",
      "integrity": "sha512-ufFd2Xi92OAVPYsy+P4n7/U7e68fex0+Ee8gSG9KX7eo084CWiQ4sdxktvdl0bOPupXtVJPY19zk6EwWqUQ8lg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/types": "^7.0.0"
      }
    },
    "node_modules/@types/babel__template": {
      "version": "7.4.4",
      "resolved": "https://registry.npmjs.org/@types/babel__template/-/babel__template-7.4.4.tgz",
      "integrity": "sha512-h/NUaSyG5EyxBIp8YRxo4RMe2/qQgvyowRwVMzhYhBCONbW8PUsg4lkFMrhgZhUe5z3L3MiLDuvyJ/CaPa2A8A==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/parser": "^7.1.0",
        "@babel/types": "^7.0.0"
      }
    },
    "node_modules/@types/babel__traverse": {
      "version": "7.20.7",
      "resolved": "https://registry.npmjs.org/@types/babel__traverse/-/babel__traverse-7.20.7.tgz",
      "integrity": "sha512-dkO5fhS7+/oos4ciWxyEyjWe48zmG6wbCheo/G2ZnHx4fs3EU6YC6UM8rk56gAjNJ9P3MTH2jo5jb92/K6wbng==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/types": "^7.20.7"
      }
    },
    "node_modules/@types/estree": {
      "version": "1.0.8",
      "resolved": "https://registry.npmjs.org/@types/estree/-/estree-1.0.8.tgz",
      "integrity": "sha512-dWHzHa2WqEXI/O1E9OjrocMTKJl2mSrEolh1Iomrv6U+JuNwaHXsXx9bLu5gG7BUWFIN0skIQJQ/L1rIex4X6w==",
      "license": "MIT"
    },
    "node_modules/@types/json-schema": {
      "version": "7.0.15",
      "resolved": "https://registry.npmjs.org/@types/json-schema/-/json-schema-7.0.15.tgz",
      "integrity": "sha512-5+fP8P8MFNC+AyZCDxrB2pkZFPGzqQWUzpSeuuVLvm8VMcorNYavBqoFcxK8bQz4Qsbn4oUEEem4wDLfcysGHA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/node": {
      "version": "24.3.1",
      "resolved": "https://registry.npmjs.org/@types/node/-/node-24.3.1.tgz",
      "integrity": "sha512-3vXmQDXy+woz+gnrTvuvNrPzekOi+Ds0ReMxw0LzBiK3a+1k0kQn9f2NWk+lgD4rJehFUmYy2gMhJ2ZI+7YP9g==",
      "devOptional": true,
      "license": "MIT",
      "dependencies": {
        "undici-types": "~7.10.0"
      }
    },
    "node_modules/@types/react": {
      "version": "19.1.8",
      "resolved": "https://registry.npmjs.org/@types/react/-/react-19.1.8.tgz",
      "integrity": "sha512-AwAfQ2Wa5bCx9WP8nZL2uMZWod7J7/JSplxbTmBQ5ms6QpqNYm672H0Vu9ZVKVngQ+ii4R/byguVEUZQyeg44g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "csstype": "^3.0.2"
      }
    },
    "node_modules/@types/react-dom": {
      "version": "19.1.6",
      "resolved": "https://registry.npmjs.org/@types/react-dom/-/react-dom-19.1.6.tgz",
      "integrity": "sha512-4hOiT/dwO8Ko0gV1m/TJZYk3y0KBnY9vzDh7W+DH17b2HFSOGgdj33dhihPeuy3l0q23+4e+hoXHV6hCC4dCXw==",
      "dev": true,
      "license": "MIT",
      "peerDependencies": {
        "@types/react": "^19.0.0"
      }
    },
    "node_modules/@typescript-eslint/eslint-plugin": {
      "version": "8.35.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/eslint-plugin/-/eslint-plugin-8.35.0.tgz",
      "integrity": "sha512-ijItUYaiWuce0N1SoSMrEd0b6b6lYkYt99pqCPfybd+HKVXtEvYhICfLdwp42MhiI5mp0oq7PKEL+g1cNiz/Eg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@eslint-community/regexpp": "^4.10.0",
        "@typescript-eslint/scope-manager": "8.35.0",
        "@typescript-eslint/type-utils": "8.35.0",
        "@typescript-eslint/utils": "8.35.0",
        "@typescript-eslint/visitor-keys": "8.35.0",
        "graphemer": "^1.4.0",
        "ignore": "^7.0.0",
        "natural-compare": "^1.4.0",
        "ts-api-utils": "^2.1.0"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      },
      "peerDependencies": {
        "@typescript-eslint/parser": "^8.35.0",
        "eslint": "^8.57.0 || ^9.0.0",
        "typescript": ">=4.8.4 <5.9.0"
      }
    },
    "node_modules/@typescript-eslint/eslint-plugin/node_modules/ignore": {
      "version": "7.0.5",
      "resolved": "https://registry.npmjs.org/ignore/-/ignore-7.0.5.tgz",
      "integrity": "sha512-Hs59xBNfUIunMFgWAbGX5cq6893IbWg4KnrjbYwX3tx0ztorVgTDA6B2sxf8ejHJ4wz8BqGUMYlnzNBer5NvGg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 4"
      }
    },
    "node_modules/@typescript-eslint/parser": {
      "version": "8.35.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/parser/-/parser-8.35.0.tgz",
      "integrity": "sha512-6sMvZePQrnZH2/cJkwRpkT7DxoAWh+g6+GFRK6bV3YQo7ogi3SX5rgF6099r5Q53Ma5qeT7LGmOmuIutF4t3lA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@typescript-eslint/scope-manager": "8.35.0",
        "@typescript-eslint/types": "8.35.0",
        "@typescript-eslint/typescript-estree": "8.35.0",
        "@typescript-eslint/visitor-keys": "8.35.0",
        "debug": "^4.3.4"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      },
      "peerDependencies": {
        "eslint": "^8.57.0 || ^9.0.0",
        "typescript": ">=4.8.4 <5.9.0"
      }
    },
    "node_modules/@typescript-eslint/project-service": {
      "version": "8.35.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/project-service/-/project-service-8.35.0.tgz",
      "integrity": "sha512-41xatqRwWZuhUMF/aZm2fcUsOFKNcG28xqRSS6ZVr9BVJtGExosLAm5A1OxTjRMagx8nJqva+P5zNIGt8RIgbQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@typescript-eslint/tsconfig-utils": "^8.35.0",
        "@typescript-eslint/types": "^8.35.0",
        "debug": "^4.3.4"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      },
      "peerDependencies": {
        "typescript": ">=4.8.4 <5.9.0"
      }
    },
    "node_modules/@typescript-eslint/scope-manager": {
      "version": "8.35.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/scope-manager/-/scope-manager-8.35.0.tgz",
      "integrity": "sha512-+AgL5+mcoLxl1vGjwNfiWq5fLDZM1TmTPYs2UkyHfFhgERxBbqHlNjRzhThJqz+ktBqTChRYY6zwbMwy0591AA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@typescript-eslint/types": "8.35.0",
        "@typescript-eslint/visitor-keys": "8.35.0"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      }
    },
    "node_modules/@typescript-eslint/tsconfig-utils": {
      "version": "8.35.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/tsconfig-utils/-/tsconfig-utils-8.35.0.tgz",
      "integrity": "sha512-04k/7247kZzFraweuEirmvUj+W3bJLI9fX6fbo1Qm2YykuBvEhRTPl8tcxlYO8kZZW+HIXfkZNoasVb8EV4jpA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      },
      "peerDependencies": {
        "typescript": ">=4.8.4 <5.9.0"
      }
    },
    "node_modules/@typescript-eslint/type-utils": {
      "version": "8.35.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/type-utils/-/type-utils-8.35.0.tgz",
      "integrity": "sha512-ceNNttjfmSEoM9PW87bWLDEIaLAyR+E6BoYJQ5PfaDau37UGca9Nyq3lBk8Bw2ad0AKvYabz6wxc7DMTO2jnNA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@typescript-eslint/typescript-estree": "8.35.0",
        "@typescript-eslint/utils": "8.35.0",
        "debug": "^4.3.4",
        "ts-api-utils": "^2.1.0"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      },
      "peerDependencies": {
        "eslint": "^8.57.0 || ^9.0.0",
        "typescript": ">=4.8.4 <5.9.0"
      }
    },
    "node_modules/@typescript-eslint/types": {
      "version": "8.35.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/types/-/types-8.35.0.tgz",
      "integrity": "sha512-0mYH3emanku0vHw2aRLNGqe7EXh9WHEhi7kZzscrMDf6IIRUQ5Jk4wp1QrledE/36KtdZrVfKnE32eZCf/vaVQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      }
    },
    "node_modules/@typescript-eslint/typescript-estree": {
      "version": "8.35.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/typescript-estree/-/typescript-estree-8.35.0.tgz",
      "integrity": "sha512-F+BhnaBemgu1Qf8oHrxyw14wq6vbL8xwWKKMwTMwYIRmFFY/1n/9T/jpbobZL8vp7QyEUcC6xGrnAO4ua8Kp7w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@typescript-eslint/project-service": "8.35.0",
        "@typescript-eslint/tsconfig-utils": "8.35.0",
        "@typescript-eslint/types": "8.35.0",
        "@typescript-eslint/visitor-keys": "8.35.0",
        "debug": "^4.3.4",
        "fast-glob": "^3.3.2",
        "is-glob": "^4.0.3",
        "minimatch": "^9.0.4",
        "semver": "^7.6.0",
        "ts-api-utils": "^2.1.0"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      },
      "peerDependencies": {
        "typescript": ">=4.8.4 <5.9.0"
      }
    },
    "node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/brace-expansion/-/brace-expansion-2.0.2.tgz",
      "integrity": "sha512-Jt0vHyM+jmUBqojB7E1NIYadt0vI0Qxjxd2TErW94wDz+E2LAm5vKMXXwg6ZZBTHPuUlDgQHKXvjGBdfcF1ZDQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "balanced-match": "^1.0.0"
      }
    },
    "node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch": {
      "version": "9.0.5",
      "resolved": "https://registry.npmjs.org/minimatch/-/minimatch-9.0.5.tgz",
      "integrity": "sha512-G6T0ZX48xgozx7587koeX9Ys2NYy6Gmv//P89sEte9V9whIapMNF4idKxnW2QtCcLiTWlb/wfCabAtAFWhhBow==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "brace-expansion": "^2.0.1"
      },
      "engines": {
        "node": ">=16 || 14 >=14.17"
      },
      "funding": {
        "url": "https://github.com/sponsors/isaacs"
      }
    },
    "node_modules/@typescript-eslint/typescript-estree/node_modules/semver": {
      "version": "7.7.2",
      "resolved": "https://registry.npmjs.org/semver/-/semver-7.7.2.tgz",
      "integrity": "sha512-RF0Fw+rO5AMf9MAyaRXI4AV0Ulj5lMHqVxxdSgiVbixSCXoEmmX/jk0CuJw4+3SqroYO9VoUh+HcuJivvtJemA==",
      "dev": true,
      "license": "ISC",
      "bin": {
        "semver": "bin/semver.js"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/@typescript-eslint/utils": {
      "version": "8.35.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/utils/-/utils-8.35.0.tgz",
      "integrity": "sha512-nqoMu7WWM7ki5tPgLVsmPM8CkqtoPUG6xXGeefM5t4x3XumOEKMoUZPdi+7F+/EotukN4R9OWdmDxN80fqoZeg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@eslint-community/eslint-utils": "^4.7.0",
        "@typescript-eslint/scope-manager": "8.35.0",
        "@typescript-eslint/types": "8.35.0",
        "@typescript-eslint/typescript-estree": "8.35.0"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      },
      "peerDependencies": {
        "eslint": "^8.57.0 || ^9.0.0",
        "typescript": ">=4.8.4 <5.9.0"
      }
    },
    "node_modules/@typescript-eslint/visitor-keys": {
      "version": "8.35.0",
      "resolved": "https://registry.npmjs.org/@typescript-eslint/visitor-keys/-/visitor-keys-8.35.0.tgz",
      "integrity": "sha512-zTh2+1Y8ZpmeQaQVIc/ZZxsx8UzgKJyNg1PTvjzC7WMhPSVS8bfDX34k1SrwOf016qd5RU3az2UxUNue3IfQ5g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@typescript-eslint/types": "8.35.0",
        "eslint-visitor-keys": "^4.2.1"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      }
    },
    "node_modules/@vitejs/plugin-react": {
      "version": "4.6.0",
      "resolved": "https://registry.npmjs.org/@vitejs/plugin-react/-/plugin-react-4.6.0.tgz",
      "integrity": "sha512-5Kgff+m8e2PB+9j51eGHEpn5kUzRKH2Ry0qGoe8ItJg7pqnkPrYPkDQZGgGmTa0EGarHrkjLvOdU3b1fzI8otQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@babel/core": "^7.27.4",
        "@babel/plugin-transform-react-jsx-self": "^7.27.1",
        "@babel/plugin-transform-react-jsx-source": "^7.27.1",
        "@rolldown/pluginutils": "1.0.0-beta.19",
        "@types/babel__core": "^7.20.5",
        "react-refresh": "^0.17.0"
      },
      "engines": {
        "node": "^14.18.0 || >=16.0.0"
      },
      "peerDependencies": {
        "vite": "^4.2.0 || ^5.0.0 || ^6.0.0 || ^7.0.0-beta.0"
      }
    },
    "node_modules/acorn": {
      "version": "8.15.0",
      "resolved": "https://registry.npmjs.org/acorn/-/acorn-8.15.0.tgz",
      "integrity": "sha512-NZyJarBfL7nWwIq+FDL6Zp/yHEhePMNnnJ0y3qfieCrmNvYct8uvtiV41UvlSe6apAfk0fY1FbWx+NwfmpvtTg==",
      "dev": true,
      "license": "MIT",
      "bin": {
        "acorn": "bin/acorn"
      },
      "engines": {
        "node": ">=0.4.0"
      }
    },
    "node_modules/acorn-jsx": {
      "version": "5.3.2",
      "resolved": "https://registry.npmjs.org/acorn-jsx/-/acorn-jsx-5.3.2.tgz",
      "integrity": "sha512-rq9s+JNhf0IChjtDXxllJ7g41oZk5SlXtp0LHwyA5cejwn7vKmKp4pPri6YEePv2PU65sAsegbXtIinmDFDXgQ==",
      "dev": true,
      "license": "MIT",
      "peerDependencies": {
        "acorn": "^6.0.0 || ^7.0.0 || ^8.0.0"
      }
    },
    "node_modules/ajv": {
      "version": "6.12.6",
      "resolved": "https://registry.npmjs.org/ajv/-/ajv-6.12.6.tgz",
      "integrity": "sha512-j3fVLgvTo527anyYyJOGTYJbG+vnnQYvE0m5mmkc1TK+nxAppkCLMIL0aZ4dblVCNoGShhm+kzE4ZUykBoMg4g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "fast-deep-equal": "^3.1.1",
        "fast-json-stable-stringify": "^2.0.0",
        "json-schema-traverse": "^0.4.1",
        "uri-js": "^4.2.2"
      },
      "funding": {
        "type": "github",
        "url": "https://github.com/sponsors/epoberezkin"
      }
    },
    "node_modules/ansi-styles": {
      "version": "4.3.0",
      "resolved": "https://registry.npmjs.org/ansi-styles/-/ansi-styles-4.3.0.tgz",
      "integrity": "sha512-zbB9rCJAT1rbjiVDb2hqKFHNYLxgtk8NURxZ3IZwD3F6NtxbXZQCnnSi1Lkx+IDohdPlFp222wVALIheZJQSEg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "color-convert": "^2.0.1"
      },
      "engines": {
        "node": ">=8"
      },
      "funding": {
        "url": "https://github.com/chalk/ansi-styles?sponsor=1"
      }
    },
    "node_modules/argparse": {
      "version": "2.0.1",
      "resolved": "https://registry.npmjs.org/argparse/-/argparse-2.0.1.tgz",
      "integrity": "sha512-8+9WqebbFzpX9OR+Wa6O29asIogeRMzcGtAINdpMHHyAg10f05aSFVBbcEqGf/PXw1EjAZ+q2/bEBg3DvurK3Q==",
      "dev": true,
      "license": "Python-2.0"
    },
    "node_modules/autoprefixer": {
      "version": "10.4.21",
      "resolved": "https://registry.npmjs.org/autoprefixer/-/autoprefixer-10.4.21.tgz",
      "integrity": "sha512-O+A6LWV5LDHSJD3LjHYoNi4VLsj/Whi7k6zG12xTYaU4cQ8oxQGckXNX8cRHK5yOZ/ppVHe0ZBXGzSV9jXdVbQ==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/postcss/"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/autoprefixer"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "browserslist": "^4.24.4",
        "caniuse-lite": "^1.0.30001702",
        "fraction.js": "^4.3.7",
        "normalize-range": "^0.1.2",
        "picocolors": "^1.1.1",
        "postcss-value-parser": "^4.2.0"
      },
      "bin": {
        "autoprefixer": "bin/autoprefixer"
      },
      "engines": {
        "node": "^10 || ^12 || >=14"
      },
      "peerDependencies": {
        "postcss": "^8.1.0"
      }
    },
    "node_modules/balanced-match": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/balanced-match/-/balanced-match-1.0.2.tgz",
      "integrity": "sha512-3oSeUO0TMV67hN1AmbXsK4yaqU7tjiHlbxRDZOpH0KW9+CeX4bRAaX0Anxt0tx2MrpRpWwQaPwIlISEJhYU5Pw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/brace-expansion": {
      "version": "1.1.12",
      "resolved": "https://registry.npmjs.org/brace-expansion/-/brace-expansion-1.1.12.tgz",
      "integrity": "sha512-9T9UjW3r0UW5c1Q7GTwllptXwhvYmEzFhzMfZ9H7FQWt+uZePjZPjBP/W1ZEyZ1twGWom5/56TF4lPcqjnDHcg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "balanced-match": "^1.0.0",
        "concat-map": "0.0.1"
      }
    },
    "node_modules/braces": {
      "version": "3.0.3",
      "resolved": "https://registry.npmjs.org/braces/-/braces-3.0.3.tgz",
      "integrity": "sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "fill-range": "^7.1.1"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/browserslist": {
      "version": "4.25.0",
      "resolved": "https://registry.npmjs.org/browserslist/-/browserslist-4.25.0.tgz",
      "integrity": "sha512-PJ8gYKeS5e/whHBh8xrwYK+dAvEj7JXtz6uTucnMRB8OiGTsKccFekoRrjajPBHV8oOY+2tI4uxeceSimKwMFA==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/browserslist"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/browserslist"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "caniuse-lite": "^1.0.30001718",
        "electron-to-chromium": "^1.5.160",
        "node-releases": "^2.0.19",
        "update-browserslist-db": "^1.1.3"
      },
      "bin": {
        "browserslist": "cli.js"
      },
      "engines": {
        "node": "^6 || ^7 || ^8 || ^9 || ^10 || ^11 || ^12 || >=13.7"
      }
    },
    "node_modules/callsites": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/callsites/-/callsites-3.1.0.tgz",
      "integrity": "sha512-P8BjAsXvZS+VIDUI11hHCQEv74YT67YUi5JJFNWIqL235sBmjX4+qx9Muvls5ivyNENctx46xQLQ3aTuE7ssaQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/caniuse-lite": {
      "version": "1.0.30001724",
      "resolved": "https://registry.npmjs.org/caniuse-lite/-/caniuse-lite-1.0.30001724.tgz",
      "integrity": "sha512-WqJo7p0TbHDOythNTqYujmaJTvtYRZrjpP8TCvH6Vb9CYJerJNKamKzIWOM4BkQatWj9H2lYulpdAQNBe7QhNA==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/browserslist"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/caniuse-lite"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "CC-BY-4.0"
    },
    "node_modules/chalk": {
      "version": "4.1.2",
      "resolved": "https://registry.npmjs.org/chalk/-/chalk-4.1.2.tgz",
      "integrity": "sha512-oKnbhFyRIXpUuez8iBMmyEa4nbj4IOQyuhc/wy9kY7/WVPcwIO9VA668Pu8RkO7+0G76SLROeyw9CpQ061i4mA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "ansi-styles": "^4.1.0",
        "supports-color": "^7.1.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/chalk/chalk?sponsor=1"
      }
    },
    "node_modules/chownr": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/chownr/-/chownr-3.0.0.tgz",
      "integrity": "sha512-+IxzY9BZOQd/XuYPRmrvEVjF/nqj5kgT4kEq7VofrDoM1MxoRjEWkrCC3EtLi59TVawxTAn+orJwFQcrqEN1+g==",
      "license": "BlueOak-1.0.0",
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/class-variance-authority": {
      "version": "0.7.1",
      "resolved": "https://registry.npmjs.org/class-variance-authority/-/class-variance-authority-0.7.1.tgz",
      "integrity": "sha512-Ka+9Trutv7G8M6WT6SeiRWz792K5qEqIGEGzXKhAE6xOWAY6pPH8U+9IY3oCMv6kqTmLsv7Xh/2w2RigkePMsg==",
      "license": "Apache-2.0",
      "dependencies": {
        "clsx": "^2.1.1"
      },
      "funding": {
        "url": "https://polar.sh/cva"
      }
    },
    "node_modules/clsx": {
      "version": "2.1.1",
      "resolved": "https://registry.npmjs.org/clsx/-/clsx-2.1.1.tgz",
      "integrity": "sha512-eYm0QWBtUrBWZWG0d386OGAw16Z995PiOVo2B7bjWSbHedGl5e0ZWaq65kOGgUSNesEIDkB9ISbTg/JK9dhCZA==",
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/color-convert": {
      "version": "2.0.1",
      "resolved": "https://registry.npmjs.org/color-convert/-/color-convert-2.0.1.tgz",
      "integrity": "sha512-RRECPsj7iu/xb5oKYcsFHSppFNnsj/52OVTRKb4zP5onXwVF3zVmmToNcOfGC+CRDpfK/U584fMg38ZHCaElKQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "color-name": "~1.1.4"
      },
      "engines": {
        "node": ">=7.0.0"
      }
    },
    "node_modules/color-name": {
      "version": "1.1.4",
      "resolved": "https://registry.npmjs.org/color-name/-/color-name-1.1.4.tgz",
      "integrity": "sha512-dOy+3AuW3a2wNbZHIuMZpTcgjGuLU/uBL/ubcZF9OXbDo8ff4O8yVp5Bf0efS8uEoYo5q4Fx7dY9OgQGXgAsQA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/concat-map": {
      "version": "0.0.1",
      "resolved": "https://registry.npmjs.org/concat-map/-/concat-map-0.0.1.tgz",
      "integrity": "sha512-/Srv4dswyQNBfohGpz9o6Yb3Gz3SrUDqBH5rTuhGR7ahtlbYKnVxw2bCFMRljaA7EXHaXZ8wsHdodFvbkhKmqg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/convert-source-map": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/convert-source-map/-/convert-source-map-2.0.0.tgz",
      "integrity": "sha512-Kvp459HrV2FEJ1CAsi1Ku+MY3kasH19TFykTz2xWmMeq6bk2NU3XXvfJ+Q61m0xktWwt+1HSYf3JZsTms3aRJg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/cross-spawn": {
      "version": "7.0.6",
      "resolved": "https://registry.npmjs.org/cross-spawn/-/cross-spawn-7.0.6.tgz",
      "integrity": "sha512-uV2QOWP2nWzsy2aMp8aRibhi9dlzF5Hgh5SHaB9OiTGEyDTiJJyx0uy51QXdyWbtAHNua4XJzUKca3OzKUd3vA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "path-key": "^3.1.0",
        "shebang-command": "^2.0.0",
        "which": "^2.0.1"
      },
      "engines": {
        "node": ">= 8"
      }
    },
    "node_modules/csstype": {
      "version": "3.1.3",
      "resolved": "https://registry.npmjs.org/csstype/-/csstype-3.1.3.tgz",
      "integrity": "sha512-M1uQkMl8rQK/szD0LNhtqxIPLpimGm8sOBwU7lLnCpSbTyY3yeU1Vc7l4KT5zT4s/yOxHH5O7tIuuLOCnLADRw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/debug": {
      "version": "4.4.1",
      "resolved": "https://registry.npmjs.org/debug/-/debug-4.4.1.tgz",
      "integrity": "sha512-KcKCqiftBJcZr++7ykoDIEwSa3XWowTfNPo92BYxjXiyYEVrUQh2aLyhxBCwww+heortUFxEJYcRzosstTEBYQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "ms": "^2.1.3"
      },
      "engines": {
        "node": ">=6.0"
      },
      "peerDependenciesMeta": {
        "supports-color": {
          "optional": true
        }
      }
    },
    "node_modules/deep-is": {
      "version": "0.1.4",
      "resolved": "https://registry.npmjs.org/deep-is/-/deep-is-0.1.4.tgz",
      "integrity": "sha512-oIPzksmTg4/MriiaYGO+okXDT7ztn/w3Eptv/+gSIdMdKsJo0u4CfYNFJPy+4SKMuCqGw2wxnA+URMg3t8a/bQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/detect-libc": {
      "version": "2.0.4",
      "resolved": "https://registry.npmjs.org/detect-libc/-/detect-libc-2.0.4.tgz",
      "integrity": "sha512-3UDv+G9CsCKO1WKMGw9fwq/SWJYbI0c5Y7LU1AXYoDdbhE2AHQ6N6Nb34sG8Fj7T5APy8qXDCKuuIHd1BR0tVA==",
      "license": "Apache-2.0",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/electron-to-chromium": {
      "version": "1.5.173",
      "resolved": "https://registry.npmjs.org/electron-to-chromium/-/electron-to-chromium-1.5.173.tgz",
      "integrity": "sha512-2bFhXP2zqSfQHugjqJIDFVwa+qIxyNApenmXTp9EjaKtdPrES5Qcn9/aSFy/NaP2E+fWG/zxKu/LBvY36p5VNQ==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/enhanced-resolve": {
      "version": "5.18.3",
      "resolved": "https://registry.npmjs.org/enhanced-resolve/-/enhanced-resolve-5.18.3.tgz",
      "integrity": "sha512-d4lC8xfavMeBjzGr2vECC3fsGXziXZQyJxD868h2M/mBI3PwAuODxAkLkq5HYuvrPYcUtiLzsTo8U3PgX3Ocww==",
      "license": "MIT",
      "dependencies": {
        "graceful-fs": "^4.2.4",
        "tapable": "^2.2.0"
      },
      "engines": {
        "node": ">=10.13.0"
      }
    },
    "node_modules/esbuild": {
      "version": "0.25.5",
      "resolved": "https://registry.npmjs.org/esbuild/-/esbuild-0.25.5.tgz",
      "integrity": "sha512-P8OtKZRv/5J5hhz0cUAdu/cLuPIKXpQl1R9pZtvmHWQvrAUVd0UNIPT4IB4W3rNOqVO0rlqHmCIbSwxh/c9yUQ==",
      "hasInstallScript": true,
      "license": "MIT",
      "bin": {
        "esbuild": "bin/esbuild"
      },
      "engines": {
        "node": ">=18"
      },
      "optionalDependencies": {
        "@esbuild/aix-ppc64": "0.25.5",
        "@esbuild/android-arm": "0.25.5",
        "@esbuild/android-arm64": "0.25.5",
        "@esbuild/android-x64": "0.25.5",
        "@esbuild/darwin-arm64": "0.25.5",
        "@esbuild/darwin-x64": "0.25.5",
        "@esbuild/freebsd-arm64": "0.25.5",
        "@esbuild/freebsd-x64": "0.25.5",
        "@esbuild/linux-arm": "0.25.5",
        "@esbuild/linux-arm64": "0.25.5",
        "@esbuild/linux-ia32": "0.25.5",
        "@esbuild/linux-loong64": "0.25.5",
        "@esbuild/linux-mips64el": "0.25.5",
        "@esbuild/linux-ppc64": "0.25.5",
        "@esbuild/linux-riscv64": "0.25.5",
        "@esbuild/linux-s390x": "0.25.5",
        "@esbuild/linux-x64": "0.25.5",
        "@esbuild/netbsd-arm64": "0.25.5",
        "@esbuild/netbsd-x64": "0.25.5",
        "@esbuild/openbsd-arm64": "0.25.5",
        "@esbuild/openbsd-x64": "0.25.5",
        "@esbuild/sunos-x64": "0.25.5",
        "@esbuild/win32-arm64": "0.25.5",
        "@esbuild/win32-ia32": "0.25.5",
        "@esbuild/win32-x64": "0.25.5"
      }
    },
    "node_modules/escalade": {
      "version": "3.2.0",
      "resolved": "https://registry.npmjs.org/escalade/-/escalade-3.2.0.tgz",
      "integrity": "sha512-WUj2qlxaQtO4g6Pq5c29GTcWGDyd8itL8zTlipgECz3JesAiiOKotd8JU6otB3PACgG6xkJUyVhboMS+bje/jA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/escape-string-regexp": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/escape-string-regexp/-/escape-string-regexp-4.0.0.tgz",
      "integrity": "sha512-TtpcNJ3XAzx3Gq8sWRzJaVajRs0uVxA2YAkdb1jm2YkPz4G6egUFAyA3n5vtEIZefPk5Wa4UXbKuS5fKkJWdgA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/eslint": {
      "version": "9.29.0",
      "resolved": "https://registry.npmjs.org/eslint/-/eslint-9.29.0.tgz",
      "integrity": "sha512-GsGizj2Y1rCWDu6XoEekL3RLilp0voSePurjZIkxL3wlm5o5EC9VpgaP7lrCvjnkuLvzFBQWB3vWB3K5KQTveQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@eslint-community/eslint-utils": "^4.2.0",
        "@eslint-community/regexpp": "^4.12.1",
        "@eslint/config-array": "^0.20.1",
        "@eslint/config-helpers": "^0.2.1",
        "@eslint/core": "^0.14.0",
        "@eslint/eslintrc": "^3.3.1",
        "@eslint/js": "9.29.0",
        "@eslint/plugin-kit": "^0.3.1",
        "@humanfs/node": "^0.16.6",
        "@humanwhocodes/module-importer": "^1.0.1",
        "@humanwhocodes/retry": "^0.4.2",
        "@types/estree": "^1.0.6",
        "@types/json-schema": "^7.0.15",
        "ajv": "^6.12.4",
        "chalk": "^4.0.0",
        "cross-spawn": "^7.0.6",
        "debug": "^4.3.2",
        "escape-string-regexp": "^4.0.0",
        "eslint-scope": "^8.4.0",
        "eslint-visitor-keys": "^4.2.1",
        "espree": "^10.4.0",
        "esquery": "^1.5.0",
        "esutils": "^2.0.2",
        "fast-deep-equal": "^3.1.3",
        "file-entry-cache": "^8.0.0",
        "find-up": "^5.0.0",
        "glob-parent": "^6.0.2",
        "ignore": "^5.2.0",
        "imurmurhash": "^0.1.4",
        "is-glob": "^4.0.0",
        "json-stable-stringify-without-jsonify": "^1.0.1",
        "lodash.merge": "^4.6.2",
        "minimatch": "^3.1.2",
        "natural-compare": "^1.4.0",
        "optionator": "^0.9.3"
      },
      "bin": {
        "eslint": "bin/eslint.js"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "url": "https://eslint.org/donate"
      },
      "peerDependencies": {
        "jiti": "*"
      },
      "peerDependenciesMeta": {
        "jiti": {
          "optional": true
        }
      }
    },
    "node_modules/eslint-plugin-react-hooks": {
      "version": "5.2.0",
      "resolved": "https://registry.npmjs.org/eslint-plugin-react-hooks/-/eslint-plugin-react-hooks-5.2.0.tgz",
      "integrity": "sha512-+f15FfK64YQwZdJNELETdn5ibXEUQmW1DZL6KXhNnc2heoy/sg9VJJeT7n8TlMWouzWqSWavFkIhHyIbIAEapg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      },
      "peerDependencies": {
        "eslint": "^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0-0 || ^9.0.0"
      }
    },
    "node_modules/eslint-plugin-react-refresh": {
      "version": "0.4.20",
      "resolved": "https://registry.npmjs.org/eslint-plugin-react-refresh/-/eslint-plugin-react-refresh-0.4.20.tgz",
      "integrity": "sha512-XpbHQ2q5gUF8BGOX4dHe+71qoirYMhApEPZ7sfhF/dNnOF1UXnCMGZf79SFTBO7Bz5YEIT4TMieSlJBWhP9WBA==",
      "dev": true,
      "license": "MIT",
      "peerDependencies": {
        "eslint": ">=8.40"
      }
    },
    "node_modules/eslint-scope": {
      "version": "8.4.0",
      "resolved": "https://registry.npmjs.org/eslint-scope/-/eslint-scope-8.4.0.tgz",
      "integrity": "sha512-sNXOfKCn74rt8RICKMvJS7XKV/Xk9kA7DyJr8mJik3S7Cwgy3qlkkmyS2uQB3jiJg6VNdZd/pDBJu0nvG2NlTg==",
      "dev": true,
      "license": "BSD-2-Clause",
      "dependencies": {
        "esrecurse": "^4.3.0",
        "estraverse": "^5.2.0"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "url": "https://opencollective.com/eslint"
      }
    },
    "node_modules/eslint-visitor-keys": {
      "version": "4.2.1",
      "resolved": "https://registry.npmjs.org/eslint-visitor-keys/-/eslint-visitor-keys-4.2.1.tgz",
      "integrity": "sha512-Uhdk5sfqcee/9H/rCOJikYz67o0a2Tw2hGRPOG2Y1R2dg7brRe1uG0yaNQDHu+TO/uQPF/5eCapvYSmHUjt7JQ==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "url": "https://opencollective.com/eslint"
      }
    },
    "node_modules/espree": {
      "version": "10.4.0",
      "resolved": "https://registry.npmjs.org/espree/-/espree-10.4.0.tgz",
      "integrity": "sha512-j6PAQ2uUr79PZhBjP5C5fhl8e39FmRnOjsD5lGnWrFU8i2G776tBK7+nP8KuQUTTyAZUwfQqXAgrVH5MbH9CYQ==",
      "dev": true,
      "license": "BSD-2-Clause",
      "dependencies": {
        "acorn": "^8.15.0",
        "acorn-jsx": "^5.3.2",
        "eslint-visitor-keys": "^4.2.1"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "url": "https://opencollective.com/eslint"
      }
    },
    "node_modules/esquery": {
      "version": "1.6.0",
      "resolved": "https://registry.npmjs.org/esquery/-/esquery-1.6.0.tgz",
      "integrity": "sha512-ca9pw9fomFcKPvFLXhBKUK90ZvGibiGOvRJNbjljY7s7uq/5YO4BOzcYtJqExdx99rF6aAcnRxHmcUHcz6sQsg==",
      "dev": true,
      "license": "BSD-3-Clause",
      "dependencies": {
        "estraverse": "^5.1.0"
      },
      "engines": {
        "node": ">=0.10"
      }
    },
    "node_modules/esrecurse": {
      "version": "4.3.0",
      "resolved": "https://registry.npmjs.org/esrecurse/-/esrecurse-4.3.0.tgz",
      "integrity": "sha512-KmfKL3b6G+RXvP8N1vr3Tq1kL/oCFgn2NYXEtqP8/L3pKapUA4G8cFVaoF3SU323CD4XypR/ffioHmkti6/Tag==",
      "dev": true,
      "license": "BSD-2-Clause",
      "dependencies": {
        "estraverse": "^5.2.0"
      },
      "engines": {
        "node": ">=4.0"
      }
    },
    "node_modules/estraverse": {
      "version": "5.3.0",
      "resolved": "https://registry.npmjs.org/estraverse/-/estraverse-5.3.0.tgz",
      "integrity": "sha512-MMdARuVEQziNTeJD8DgMqmhwR11BRQ/cBP+pLtYdSTnf3MIO8fFeiINEbX36ZdNlfU/7A9f3gUw49B3oQsvwBA==",
      "dev": true,
      "license": "BSD-2-Clause",
      "engines": {
        "node": ">=4.0"
      }
    },
    "node_modules/esutils": {
      "version": "2.0.3",
      "resolved": "https://registry.npmjs.org/esutils/-/esutils-2.0.3.tgz",
      "integrity": "sha512-kVscqXk4OCp68SZ0dkgEKVi6/8ij300KBWTJq32P/dYeWTSwK41WyTxalN1eRmA5Z9UU/LX9D7FWSmV9SAYx6g==",
      "dev": true,
      "license": "BSD-2-Clause",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/fast-deep-equal": {
      "version": "3.1.3",
      "resolved": "https://registry.npmjs.org/fast-deep-equal/-/fast-deep-equal-3.1.3.tgz",
      "integrity": "sha512-f3qQ9oQy9j2AhBe/H9VC91wLmKBCCU/gDOnKNAYG5hswO7BLKj09Hc5HYNz9cGI++xlpDCIgDaitVs03ATR84Q==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/fast-glob": {
      "version": "3.3.3",
      "resolved": "https://registry.npmjs.org/fast-glob/-/fast-glob-3.3.3.tgz",
      "integrity": "sha512-7MptL8U0cqcFdzIzwOTHoilX9x5BrNqye7Z/LuC7kCMRio1EMSyqRK3BEAUD7sXRq4iT4AzTVuZdhgQ2TCvYLg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@nodelib/fs.stat": "^2.0.2",
        "@nodelib/fs.walk": "^1.2.3",
        "glob-parent": "^5.1.2",
        "merge2": "^1.3.0",
        "micromatch": "^4.0.8"
      },
      "engines": {
        "node": ">=8.6.0"
      }
    },
    "node_modules/fast-glob/node_modules/glob-parent": {
      "version": "5.1.2",
      "resolved": "https://registry.npmjs.org/glob-parent/-/glob-parent-5.1.2.tgz",
      "integrity": "sha512-AOIgSQCepiJYwP3ARnGx+5VnTu2HBYdzbGP45eLw1vr3zB3vZLeyed1sC9hnbcOc9/SrMyM5RPQrkGz4aS9Zow==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "is-glob": "^4.0.1"
      },
      "engines": {
        "node": ">= 6"
      }
    },
    "node_modules/fast-json-stable-stringify": {
      "version": "2.1.0",
      "resolved": "https://registry.npmjs.org/fast-json-stable-stringify/-/fast-json-stable-stringify-2.1.0.tgz",
      "integrity": "sha512-lhd/wF+Lk98HZoTCtlVraHtfh5XYijIjalXck7saUtuanSDyLMxnHhSXEDJqHxD7msR8D0uCmqlkwjCV8xvwHw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/fast-levenshtein": {
      "version": "2.0.6",
      "resolved": "https://registry.npmjs.org/fast-levenshtein/-/fast-levenshtein-2.0.6.tgz",
      "integrity": "sha512-DCXu6Ifhqcks7TZKY3Hxp3y6qphY5SJZmrWMDrKcERSOXWQdMhU9Ig/PYrzyw/ul9jOIyh0N4M0tbC5hodg8dw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/fastq": {
      "version": "1.19.1",
      "resolved": "https://registry.npmjs.org/fastq/-/fastq-1.19.1.tgz",
      "integrity": "sha512-GwLTyxkCXjXbxqIhTsMI2Nui8huMPtnxg7krajPJAjnEG/iiOS7i+zCtWGZR9G0NBKbXKh6X9m9UIsYX/N6vvQ==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "reusify": "^1.0.4"
      }
    },
    "node_modules/file-entry-cache": {
      "version": "8.0.0",
      "resolved": "https://registry.npmjs.org/file-entry-cache/-/file-entry-cache-8.0.0.tgz",
      "integrity": "sha512-XXTUwCvisa5oacNGRP9SfNtYBNAMi+RPwBFmblZEF7N7swHYQS6/Zfk7SRwx4D5j3CH211YNRco1DEMNVfZCnQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "flat-cache": "^4.0.0"
      },
      "engines": {
        "node": ">=16.0.0"
      }
    },
    "node_modules/fill-range": {
      "version": "7.1.1",
      "resolved": "https://registry.npmjs.org/fill-range/-/fill-range-7.1.1.tgz",
      "integrity": "sha512-YsGpe3WHLK8ZYi4tWDg2Jy3ebRz2rXowDxnld4bkQB00cc/1Zw9AWnC0i9ztDJitivtQvaI9KaLyKrc+hBW0yg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "to-regex-range": "^5.0.1"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/find-up": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/find-up/-/find-up-5.0.0.tgz",
      "integrity": "sha512-78/PXT1wlLLDgTzDs7sjq9hzz0vXD+zn+7wypEe4fXQxCmdmqfGsEPQxmiCSQI3ajFV91bVSsvNtrJRiW6nGng==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "locate-path": "^6.0.0",
        "path-exists": "^4.0.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/flat-cache": {
      "version": "4.0.1",
      "resolved": "https://registry.npmjs.org/flat-cache/-/flat-cache-4.0.1.tgz",
      "integrity": "sha512-f7ccFPK3SXFHpx15UIGyRJ/FJQctuKZ0zVuN3frBo4HnK3cay9VEW0R6yPYFHC0AgqhukPzKjq22t5DmAyqGyw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "flatted": "^3.2.9",
        "keyv": "^4.5.4"
      },
      "engines": {
        "node": ">=16"
      }
    },
    "node_modules/flatted": {
      "version": "3.3.3",
      "resolved": "https://registry.npmjs.org/flatted/-/flatted-3.3.3.tgz",
      "integrity": "sha512-GX+ysw4PBCz0PzosHDepZGANEuFCMLrnRTiEy9McGjmkCQYwRq4A/X786G/fjM/+OjsWSU1ZrY5qyARZmO/uwg==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/fraction.js": {
      "version": "4.3.7",
      "resolved": "https://registry.npmjs.org/fraction.js/-/fraction.js-4.3.7.tgz",
      "integrity": "sha512-ZsDfxO51wGAXREY55a7la9LScWpwv9RxIrYABrlvOFBlH/ShPnrtsXeuUIfXKKOVicNxQ+o8JTbJvjS4M89yew==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "*"
      },
      "funding": {
        "type": "patreon",
        "url": "https://github.com/sponsors/rawify"
      }
    },
    "node_modules/framer-motion": {
      "version": "12.23.12",
      "resolved": "https://registry.npmjs.org/framer-motion/-/framer-motion-12.23.12.tgz",
      "integrity": "sha512-6e78rdVtnBvlEVgu6eFEAgG9v3wLnYEboM8I5O5EXvfKC8gxGQB8wXJdhkMy10iVcn05jl6CNw7/HTsTCfwcWg==",
      "license": "MIT",
      "dependencies": {
        "motion-dom": "^12.23.12",
        "motion-utils": "^12.23.6",
        "tslib": "^2.4.0"
      },
      "peerDependencies": {
        "@emotion/is-prop-valid": "*",
        "react": "^18.0.0 || ^19.0.0",
        "react-dom": "^18.0.0 || ^19.0.0"
      },
      "peerDependenciesMeta": {
        "@emotion/is-prop-valid": {
          "optional": true
        },
        "react": {
          "optional": true
        },
        "react-dom": {
          "optional": true
        }
      }
    },
    "node_modules/fsevents": {
      "version": "2.3.3",
      "resolved": "https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz",
      "integrity": "sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==",
      "hasInstallScript": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": "^8.16.0 || ^10.6.0 || >=11.0.0"
      }
    },
    "node_modules/gensync": {
      "version": "1.0.0-beta.2",
      "resolved": "https://registry.npmjs.org/gensync/-/gensync-1.0.0-beta.2.tgz",
      "integrity": "sha512-3hN7NaskYvMDLQY55gnW3NQ+mesEAepTqlg+VEbj7zzqEMBVNhzcGYYeqFo/TlYz6eQiFcp1HcsCZO+nGgS8zg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/glob-parent": {
      "version": "6.0.2",
      "resolved": "https://registry.npmjs.org/glob-parent/-/glob-parent-6.0.2.tgz",
      "integrity": "sha512-XxwI8EOhVQgWp6iDL+3b0r86f4d6AX6zSU55HfB4ydCEuXLXc5FcYeOu+nnGftS4TEju/11rt4KJPTMgbfmv4A==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "is-glob": "^4.0.3"
      },
      "engines": {
        "node": ">=10.13.0"
      }
    },
    "node_modules/globals": {
      "version": "16.2.0",
      "resolved": "https://registry.npmjs.org/globals/-/globals-16.2.0.tgz",
      "integrity": "sha512-O+7l9tPdHCU320IigZZPj5zmRCFG9xHmx9cU8FqU2Rp+JN714seHV+2S9+JslCpY4gJwU2vOGox0wzgae/MCEg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=18"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/graceful-fs": {
      "version": "4.2.11",
      "resolved": "https://registry.npmjs.org/graceful-fs/-/graceful-fs-4.2.11.tgz",
      "integrity": "sha512-RbJ5/jmFcNNCcDV5o9eTnBLJ/HszWV0P73bc+Ff4nS/rJj+YaS6IGyiOL0VoBYX+l1Wrl3k63h/KrH+nhJ0XvQ==",
      "license": "ISC"
    },
    "node_modules/graphemer": {
      "version": "1.4.0",
      "resolved": "https://registry.npmjs.org/graphemer/-/graphemer-1.4.0.tgz",
      "integrity": "sha512-EtKwoO6kxCL9WO5xipiHTZlSzBm7WLT627TqC/uVRd0HKmq8NXyebnNYxDoBi7wt8eTWrUrKXCOVaFq9x1kgag==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/has-flag": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/has-flag/-/has-flag-4.0.0.tgz",
      "integrity": "sha512-EykJT/Q1KjTWctppgIAgfSO0tKVuZUjhgMr17kqTumMl6Afv3EISleU7qZUzoXDFTAHTDC4NOoG/ZxU3EvlMPQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/ignore": {
      "version": "5.3.2",
      "resolved": "https://registry.npmjs.org/ignore/-/ignore-5.3.2.tgz",
      "integrity": "sha512-hsBTNUqQTDwkWtcdYI2i06Y/nUBEsNEDJKjWdigLvegy8kDuJAS8uRlpkkcQpyEXL0Z/pjDy5HBmMjRCJ2gq+g==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 4"
      }
    },
    "node_modules/import-fresh": {
      "version": "3.3.1",
      "resolved": "https://registry.npmjs.org/import-fresh/-/import-fresh-3.3.1.tgz",
      "integrity": "sha512-TR3KfrTZTYLPB6jUjfx6MF9WcWrHL9su5TObK4ZkYgBdWKPOFoSoQIdEuTuR82pmtxH2spWG9h6etwfr1pLBqQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "parent-module": "^1.0.0",
        "resolve-from": "^4.0.0"
      },
      "engines": {
        "node": ">=6"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/imurmurhash": {
      "version": "0.1.4",
      "resolved": "https://registry.npmjs.org/imurmurhash/-/imurmurhash-0.1.4.tgz",
      "integrity": "sha512-JmXMZ6wuvDmLiHEml9ykzqO6lwFbof0GG4IkcGaENdCRDDmMVnny7s5HsIgHCbaq0w2MyPhDqkhTUgS2LU2PHA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.8.19"
      }
    },
    "node_modules/is-extglob": {
      "version": "2.1.1",
      "resolved": "https://registry.npmjs.org/is-extglob/-/is-extglob-2.1.1.tgz",
      "integrity": "sha512-SbKbANkN603Vi4jEZv49LeVJMn4yGwsbzZworEoyEiutsN3nJYdbO36zfhGJ6QEDpOZIFkDtnq5JRxmvl3jsoQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/is-glob": {
      "version": "4.0.3",
      "resolved": "https://registry.npmjs.org/is-glob/-/is-glob-4.0.3.tgz",
      "integrity": "sha512-xelSayHH36ZgE7ZWhli7pW34hNbNl8Ojv5KVmkJD4hBdD3th8Tfk9vYasLM+mXWOZhFkgZfxhLSnrwRr4elSSg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "is-extglob": "^2.1.1"
      },
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/is-number": {
      "version": "7.0.0",
      "resolved": "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz",
      "integrity": "sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.12.0"
      }
    },
    "node_modules/isexe": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/isexe/-/isexe-2.0.0.tgz",
      "integrity": "sha512-RHxMLp9lnKHGHRng9QFhRCMbYAcVpn69smSGcq3f36xjgVVWThj4qqLbTLlq7Ssj8B+fIQ1EuCEGI2lKsyQeIw==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/jiti": {
      "version": "2.5.1",
      "resolved": "https://registry.npmjs.org/jiti/-/jiti-2.5.1.tgz",
      "integrity": "sha512-twQoecYPiVA5K/h6SxtORw/Bs3ar+mLUtoPSc7iMXzQzK8d7eJ/R09wmTwAjiamETn1cXYPGfNnu7DMoHgu12w==",
      "license": "MIT",
      "bin": {
        "jiti": "lib/jiti-cli.mjs"
      }
    },
    "node_modules/js-tokens": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/js-tokens/-/js-tokens-4.0.0.tgz",
      "integrity": "sha512-RdJUflcE3cUzKiMqQgsCu06FPu9UdIJO0beYbPhHN4k6apgJtifcoCtT9bcxOpYBtpD2kCM6Sbzg4CausW/PKQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/js-yaml": {
      "version": "4.1.0",
      "resolved": "https://registry.npmjs.org/js-yaml/-/js-yaml-4.1.0.tgz",
      "integrity": "sha512-wpxZs9NoxZaJESJGIZTyDEaYpl0FKSA+FB9aJiyemKhMwkxQg63h4T1KJgUGHpTqPDNRcmmYLugrRjJlBtWvRA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "argparse": "^2.0.1"
      },
      "bin": {
        "js-yaml": "bin/js-yaml.js"
      }
    },
    "node_modules/jsesc": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/jsesc/-/jsesc-3.1.0.tgz",
      "integrity": "sha512-/sM3dO2FOzXjKQhJuo0Q173wf2KOo8t4I8vHy6lF9poUp7bKT0/NHE8fPX23PwfhnykfqnC2xRxOnVw5XuGIaA==",
      "dev": true,
      "license": "MIT",
      "bin": {
        "jsesc": "bin/jsesc"
      },
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/json-buffer": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/json-buffer/-/json-buffer-3.0.1.tgz",
      "integrity": "sha512-4bV5BfR2mqfQTJm+V5tPPdf+ZpuhiIvTuAB5g8kcrXOZpTT/QwwVRWBywX1ozr6lEuPdbHxwaJlm9G6mI2sfSQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/json-schema-traverse": {
      "version": "0.4.1",
      "resolved": "https://registry.npmjs.org/json-schema-traverse/-/json-schema-traverse-0.4.1.tgz",
      "integrity": "sha512-xbbCH5dCYU5T8LcEhhuh7HJ88HXuW3qsI3Y0zOZFKfZEHcpWiHU/Jxzk629Brsab/mMiHQti9wMP+845RPe3Vg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/json-stable-stringify-without-jsonify": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/json-stable-stringify-without-jsonify/-/json-stable-stringify-without-jsonify-1.0.1.tgz",
      "integrity": "sha512-Bdboy+l7tA3OGW6FjyFHWkP5LuByj1Tk33Ljyq0axyzdk9//JSi2u3fP1QSmd1KNwq6VOKYGlAu87CisVir6Pw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/json5": {
      "version": "2.2.3",
      "resolved": "https://registry.npmjs.org/json5/-/json5-2.2.3.tgz",
      "integrity": "sha512-XmOWe7eyHYH14cLdVPoyg+GOH3rYX++KpzrylJwSW98t3Nk+U8XOl8FWKOgwtzdb8lXGf6zYwDUzeHMWfxasyg==",
      "dev": true,
      "license": "MIT",
      "bin": {
        "json5": "lib/cli.js"
      },
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/keyv": {
      "version": "4.5.4",
      "resolved": "https://registry.npmjs.org/keyv/-/keyv-4.5.4.tgz",
      "integrity": "sha512-oxVHkHR/EJf2CNXnWxRLW6mg7JyCCUcG0DtEGmL2ctUo1PNTin1PUil+r/+4r5MpVgC/fn1kjsx7mjSujKqIpw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "json-buffer": "3.0.1"
      }
    },
    "node_modules/levn": {
      "version": "0.4.1",
      "resolved": "https://registry.npmjs.org/levn/-/levn-0.4.1.tgz",
      "integrity": "sha512-+bT2uH4E5LGE7h/n3evcS/sQlJXCpIp6ym8OWJ5eV6+67Dsql/LaaT7qJBAt2rzfoa/5QBGBhxDix1dMt2kQKQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "prelude-ls": "^1.2.1",
        "type-check": "~0.4.0"
      },
      "engines": {
        "node": ">= 0.8.0"
      }
    },
    "node_modules/lightningcss": {
      "version": "1.30.1",
      "resolved": "https://registry.npmjs.org/lightningcss/-/lightningcss-1.30.1.tgz",
      "integrity": "sha512-xi6IyHML+c9+Q3W0S4fCQJOym42pyurFiJUHEcEyHS0CeKzia4yZDEsLlqOFykxOdHpNy0NmvVO31vcSqAxJCg==",
      "license": "MPL-2.0",
      "dependencies": {
        "detect-libc": "^2.0.3"
      },
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      },
      "optionalDependencies": {
        "lightningcss-darwin-arm64": "1.30.1",
        "lightningcss-darwin-x64": "1.30.1",
        "lightningcss-freebsd-x64": "1.30.1",
        "lightningcss-linux-arm-gnueabihf": "1.30.1",
        "lightningcss-linux-arm64-gnu": "1.30.1",
        "lightningcss-linux-arm64-musl": "1.30.1",
        "lightningcss-linux-x64-gnu": "1.30.1",
        "lightningcss-linux-x64-musl": "1.30.1",
        "lightningcss-win32-arm64-msvc": "1.30.1",
        "lightningcss-win32-x64-msvc": "1.30.1"
      }
    },
    "node_modules/lightningcss-darwin-arm64": {
      "version": "1.30.1",
      "resolved": "https://registry.npmjs.org/lightningcss-darwin-arm64/-/lightningcss-darwin-arm64-1.30.1.tgz",
      "integrity": "sha512-c8JK7hyE65X1MHMN+Viq9n11RRC7hgin3HhYKhrMyaXflk5GVplZ60IxyoVtzILeKr+xAJwg6zK6sjTBJ0FKYQ==",
      "cpu": [
        "arm64"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-darwin-x64": {
      "version": "1.30.1",
      "resolved": "https://registry.npmjs.org/lightningcss-darwin-x64/-/lightningcss-darwin-x64-1.30.1.tgz",
      "integrity": "sha512-k1EvjakfumAQoTfcXUcHQZhSpLlkAuEkdMBsI/ivWw9hL+7FtilQc0Cy3hrx0AAQrVtQAbMI7YjCgYgvn37PzA==",
      "cpu": [
        "x64"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-freebsd-x64": {
      "version": "1.30.1",
      "resolved": "https://registry.npmjs.org/lightningcss-freebsd-x64/-/lightningcss-freebsd-x64-1.30.1.tgz",
      "integrity": "sha512-kmW6UGCGg2PcyUE59K5r0kWfKPAVy4SltVeut+umLCFoJ53RdCUWxcRDzO1eTaxf/7Q2H7LTquFHPL5R+Gjyig==",
      "cpu": [
        "x64"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-arm-gnueabihf": {
      "version": "1.30.1",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-arm-gnueabihf/-/lightningcss-linux-arm-gnueabihf-1.30.1.tgz",
      "integrity": "sha512-MjxUShl1v8pit+6D/zSPq9S9dQ2NPFSQwGvxBCYaBYLPlCWuPh9/t1MRS8iUaR8i+a6w7aps+B4N0S1TYP/R+Q==",
      "cpu": [
        "arm"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-arm64-gnu": {
      "version": "1.30.1",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-arm64-gnu/-/lightningcss-linux-arm64-gnu-1.30.1.tgz",
      "integrity": "sha512-gB72maP8rmrKsnKYy8XUuXi/4OctJiuQjcuqWNlJQ6jZiWqtPvqFziskH3hnajfvKB27ynbVCucKSm2rkQp4Bw==",
      "cpu": [
        "arm64"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-arm64-musl": {
      "version": "1.30.1",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-arm64-musl/-/lightningcss-linux-arm64-musl-1.30.1.tgz",
      "integrity": "sha512-jmUQVx4331m6LIX+0wUhBbmMX7TCfjF5FoOH6SD1CttzuYlGNVpA7QnrmLxrsub43ClTINfGSYyHe2HWeLl5CQ==",
      "cpu": [
        "arm64"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-x64-gnu": {
      "version": "1.30.1",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-x64-gnu/-/lightningcss-linux-x64-gnu-1.30.1.tgz",
      "integrity": "sha512-piWx3z4wN8J8z3+O5kO74+yr6ze/dKmPnI7vLqfSqI8bccaTGY5xiSGVIJBDd5K5BHlvVLpUB3S2YCfelyJ1bw==",
      "cpu": [
        "x64"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-linux-x64-musl": {
      "version": "1.30.1",
      "resolved": "https://registry.npmjs.org/lightningcss-linux-x64-musl/-/lightningcss-linux-x64-musl-1.30.1.tgz",
      "integrity": "sha512-rRomAK7eIkL+tHY0YPxbc5Dra2gXlI63HL+v1Pdi1a3sC+tJTcFrHX+E86sulgAXeI7rSzDYhPSeHHjqFhqfeQ==",
      "cpu": [
        "x64"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-win32-arm64-msvc": {
      "version": "1.30.1",
      "resolved": "https://registry.npmjs.org/lightningcss-win32-arm64-msvc/-/lightningcss-win32-arm64-msvc-1.30.1.tgz",
      "integrity": "sha512-mSL4rqPi4iXq5YVqzSsJgMVFENoa4nGTT/GjO2c0Yl9OuQfPsIfncvLrEW6RbbB24WtZ3xP/2CCmI3tNkNV4oA==",
      "cpu": [
        "arm64"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/lightningcss-win32-x64-msvc": {
      "version": "1.30.1",
      "resolved": "https://registry.npmjs.org/lightningcss-win32-x64-msvc/-/lightningcss-win32-x64-msvc-1.30.1.tgz",
      "integrity": "sha512-PVqXh48wh4T53F/1CCu8PIPCxLzWyCnn/9T5W1Jpmdy5h9Cwd+0YQS6/LwhHXSafuc61/xg9Lv5OrCby6a++jg==",
      "cpu": [
        "x64"
      ],
      "license": "MPL-2.0",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">= 12.0.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/parcel"
      }
    },
    "node_modules/locate-path": {
      "version": "6.0.0",
      "resolved": "https://registry.npmjs.org/locate-path/-/locate-path-6.0.0.tgz",
      "integrity": "sha512-iPZK6eYjbxRu3uB4/WZ3EsEIMJFMqAoopl3R+zuq0UjcAm/MO6KCweDgPfP3elTztoKP3KtnVHxTn2NHBSDVUw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "p-locate": "^5.0.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/lodash.merge": {
      "version": "4.6.2",
      "resolved": "https://registry.npmjs.org/lodash.merge/-/lodash.merge-4.6.2.tgz",
      "integrity": "sha512-0KpjqXRVvrYyCsX1swR/XTK0va6VQkQM6MNo7PqW77ByjAhoARA8EfrP1N4+KlKj8YS0ZUCtRT/YUuhyYDujIQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/lru-cache": {
      "version": "5.1.1",
      "resolved": "https://registry.npmjs.org/lru-cache/-/lru-cache-5.1.1.tgz",
      "integrity": "sha512-KpNARQA3Iwv+jTA0utUVVbrh+Jlrr1Fv0e56GGzAFOXN7dk/FviaDW8LHmK52DlcH4WP2n6gI8vN1aesBFgo9w==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "yallist": "^3.0.2"
      }
    },
    "node_modules/lucide-react": {
      "version": "0.542.0",
      "resolved": "https://registry.npmjs.org/lucide-react/-/lucide-react-0.542.0.tgz",
      "integrity": "sha512-w3hD8/SQB7+lzU2r4VdFyzzOzKnUjTZIF/MQJGSSvni7Llewni4vuViRppfRAa2guOsY5k4jZyxw/i9DQHv+dw==",
      "license": "ISC",
      "peerDependencies": {
        "react": "^16.5.1 || ^17.0.0 || ^18.0.0 || ^19.0.0"
      }
    },
    "node_modules/magic-string": {
      "version": "0.30.18",
      "resolved": "https://registry.npmjs.org/magic-string/-/magic-string-0.30.18.tgz",
      "integrity": "sha512-yi8swmWbO17qHhwIBNeeZxTceJMeBvWJaId6dyvTSOwTipqeHhMhOrz6513r1sOKnpvQ7zkhlG8tPrpilwTxHQ==",
      "license": "MIT",
      "dependencies": {
        "@jridgewell/sourcemap-codec": "^1.5.5"
      }
    },
    "node_modules/merge2": {
      "version": "1.4.1",
      "resolved": "https://registry.npmjs.org/merge2/-/merge2-1.4.1.tgz",
      "integrity": "sha512-8q7VEgMJW4J8tcfVPy8g09NcQwZdbwFEqhe/WZkoIzjn/3TGDwtOCYtXGxA3O8tPzpczCCDgv+P2P5y00ZJOOg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 8"
      }
    },
    "node_modules/micromatch": {
      "version": "4.0.8",
      "resolved": "https://registry.npmjs.org/micromatch/-/micromatch-4.0.8.tgz",
      "integrity": "sha512-PXwfBhYu0hBCPw8Dn0E+WDYb7af3dSLVWKi3HGv84IdF4TyFoC0ysxFd0Goxw7nSv4T/PzEJQxsYsEiFCKo2BA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "braces": "^3.0.3",
        "picomatch": "^2.3.1"
      },
      "engines": {
        "node": ">=8.6"
      }
    },
    "node_modules/minimatch": {
      "version": "3.1.2",
      "resolved": "https://registry.npmjs.org/minimatch/-/minimatch-3.1.2.tgz",
      "integrity": "sha512-J7p63hRiAjw1NDEww1W7i37+ByIrOWO5XQQAzZ3VOcL0PNybwpfmV/N05zFAzwQ9USyEcX6t3UO+K5aqBQOIHw==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "brace-expansion": "^1.1.7"
      },
      "engines": {
        "node": "*"
      }
    },
    "node_modules/minipass": {
      "version": "7.1.2",
      "resolved": "https://registry.npmjs.org/minipass/-/minipass-7.1.2.tgz",
      "integrity": "sha512-qOOzS1cBTWYF4BH8fVePDBOO9iptMnGUEZwNc/cMWnTV2nVLZ7VoNWEPHkYczZA0pdoA7dl6e7FL659nX9S2aw==",
      "license": "ISC",
      "engines": {
        "node": ">=16 || 14 >=14.17"
      }
    },
    "node_modules/minizlib": {
      "version": "3.0.2",
      "resolved": "https://registry.npmjs.org/minizlib/-/minizlib-3.0.2.tgz",
      "integrity": "sha512-oG62iEk+CYt5Xj2YqI5Xi9xWUeZhDI8jjQmC5oThVH5JGCTgIjr7ciJDzC7MBzYd//WvR1OTmP5Q38Q8ShQtVA==",
      "license": "MIT",
      "dependencies": {
        "minipass": "^7.1.2"
      },
      "engines": {
        "node": ">= 18"
      }
    },
    "node_modules/mkdirp": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/mkdirp/-/mkdirp-3.0.1.tgz",
      "integrity": "sha512-+NsyUUAZDmo6YVHzL/stxSu3t9YS1iljliy3BSDrXJ/dkn1KYdmtZODGGjLcc9XLgVVpH4KshHB8XmZgMhaBXg==",
      "license": "MIT",
      "bin": {
        "mkdirp": "dist/cjs/src/bin.js"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/isaacs"
      }
    },
    "node_modules/motion": {
      "version": "12.23.12",
      "resolved": "https://registry.npmjs.org/motion/-/motion-12.23.12.tgz",
      "integrity": "sha512-8jCD8uW5GD1csOoqh1WhH1A6j5APHVE15nuBkFeRiMzYBdRwyAHmSP/oXSuW0WJPZRXTFdBoG4hY9TFWNhhwng==",
      "license": "MIT",
      "dependencies": {
        "framer-motion": "^12.23.12",
        "tslib": "^2.4.0"
      },
      "peerDependencies": {
        "@emotion/is-prop-valid": "*",
        "react": "^18.0.0 || ^19.0.0",
        "react-dom": "^18.0.0 || ^19.0.0"
      },
      "peerDependenciesMeta": {
        "@emotion/is-prop-valid": {
          "optional": true
        },
        "react": {
          "optional": true
        },
        "react-dom": {
          "optional": true
        }
      }
    },
    "node_modules/motion-dom": {
      "version": "12.23.12",
      "resolved": "https://registry.npmjs.org/motion-dom/-/motion-dom-12.23.12.tgz",
      "integrity": "sha512-RcR4fvMCTESQBD/uKQe49D5RUeDOokkGRmz4ceaJKDBgHYtZtntC/s2vLvY38gqGaytinij/yi3hMcWVcEF5Kw==",
      "license": "MIT",
      "dependencies": {
        "motion-utils": "^12.23.6"
      }
    },
    "node_modules/motion-utils": {
      "version": "12.23.6",
      "resolved": "https://registry.npmjs.org/motion-utils/-/motion-utils-12.23.6.tgz",
      "integrity": "sha512-eAWoPgr4eFEOFfg2WjIsMoqJTW6Z8MTUCgn/GZ3VRpClWBdnbjryiA3ZSNLyxCTmCQx4RmYX6jX1iWHbenUPNQ==",
      "license": "MIT"
    },
    "node_modules/ms": {
      "version": "2.1.3",
      "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
      "integrity": "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/nanoid": {
      "version": "3.3.11",
      "resolved": "https://registry.npmjs.org/nanoid/-/nanoid-3.3.11.tgz",
      "integrity": "sha512-N8SpfPUnUp1bK+PMYW8qSWdl9U+wwNWI4QKxOYDy9JAro3WMX7p2OeVRF9v+347pnakNevPmiHhNmZ2HbFA76w==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "bin": {
        "nanoid": "bin/nanoid.cjs"
      },
      "engines": {
        "node": "^10 || ^12 || ^13.7 || ^14 || >=15.0.1"
      }
    },
    "node_modules/natural-compare": {
      "version": "1.4.0",
      "resolved": "https://registry.npmjs.org/natural-compare/-/natural-compare-1.4.0.tgz",
      "integrity": "sha512-OWND8ei3VtNC9h7V60qff3SVobHr996CTwgxubgyQYEpg290h9J0buyECNNJexkFm5sOajh5G116RYA1c8ZMSw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/node-releases": {
      "version": "2.0.19",
      "resolved": "https://registry.npmjs.org/node-releases/-/node-releases-2.0.19.tgz",
      "integrity": "sha512-xxOWJsBKtzAq7DY0J+DTzuz58K8e7sJbdgwkbMWQe8UYB6ekmsQ45q0M/tJDsGaZmbC+l7n57UV8Hl5tHxO9uw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/normalize-range": {
      "version": "0.1.2",
      "resolved": "https://registry.npmjs.org/normalize-range/-/normalize-range-0.1.2.tgz",
      "integrity": "sha512-bdok/XvKII3nUpklnV6P2hxtMNrCboOjAcyBuQnWEhO665FwrSNRxU+AqpsyvO6LgGYPspN+lu5CLtw4jPRKNA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/optionator": {
      "version": "0.9.4",
      "resolved": "https://registry.npmjs.org/optionator/-/optionator-0.9.4.tgz",
      "integrity": "sha512-6IpQ7mKUxRcZNLIObR0hz7lxsapSSIYNZJwXPGeF0mTVqGKFIXj1DQcMoT22S3ROcLyY/rz0PWaWZ9ayWmad9g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "deep-is": "^0.1.3",
        "fast-levenshtein": "^2.0.6",
        "levn": "^0.4.1",
        "prelude-ls": "^1.2.1",
        "type-check": "^0.4.0",
        "word-wrap": "^1.2.5"
      },
      "engines": {
        "node": ">= 0.8.0"
      }
    },
    "node_modules/p-limit": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/p-limit/-/p-limit-3.1.0.tgz",
      "integrity": "sha512-TYOanM3wGwNGsZN2cVTYPArw454xnXj5qmWF1bEoAc4+cU/ol7GVh7odevjp1FNHduHc3KZMcFduxU5Xc6uJRQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "yocto-queue": "^0.1.0"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/p-locate": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/p-locate/-/p-locate-5.0.0.tgz",
      "integrity": "sha512-LaNjtRWUBY++zB5nE/NwcaoMylSPk+S+ZHNB1TzdbMJMny6dynpAGt7X/tl/QYq3TIeE6nxHppbo2LGymrG5Pw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "p-limit": "^3.0.2"
      },
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/parent-module": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/parent-module/-/parent-module-1.0.1.tgz",
      "integrity": "sha512-GQ2EWRpQV8/o+Aw8YqtfZZPfNRWZYkbidE9k5rpl/hC3vtHHBfGm2Ifi6qWV+coDGkrUKZAxE3Lot5kcsRlh+g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "callsites": "^3.0.0"
      },
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/path-exists": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/path-exists/-/path-exists-4.0.0.tgz",
      "integrity": "sha512-ak9Qy5Q7jYb2Wwcey5Fpvg2KoAc/ZIhLSLOSBmRmygPsGwkVVt0fZa0qrtMz+m6tJTAHfZQ8FnmB4MG4LWy7/w==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/path-key": {
      "version": "3.1.1",
      "resolved": "https://registry.npmjs.org/path-key/-/path-key-3.1.1.tgz",
      "integrity": "sha512-ojmeN0qd+y0jszEtoY48r0Peq5dwMEkIlCOu6Q5f41lfkswXuKtYrhgoTpLnyIcHm24Uhqx+5Tqm2InSwLhE6Q==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/picocolors": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/picocolors/-/picocolors-1.1.1.tgz",
      "integrity": "sha512-xceH2snhtb5M9liqDsmEw56le376mTZkEX/jEb/RxNFyegNul7eNslCXP9FDj/Lcu0X8KEyMceP2ntpaHrDEVA==",
      "license": "ISC"
    },
    "node_modules/picomatch": {
      "version": "2.3.1",
      "resolved": "https://registry.npmjs.org/picomatch/-/picomatch-2.3.1.tgz",
      "integrity": "sha512-JU3teHTNjmE2VCGFzuY8EXzCDVwEqB2a8fsIvwaStHhAWJEeVd1o1QD80CU6+ZdEXXSLbSsuLwJjkCBWqRQUVA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8.6"
      },
      "funding": {
        "url": "https://github.com/sponsors/jonschlinkert"
      }
    },
    "node_modules/postcss": {
      "version": "8.5.6",
      "resolved": "https://registry.npmjs.org/postcss/-/postcss-8.5.6.tgz",
      "integrity": "sha512-3Ybi1tAuwAP9s0r1UQ2J4n5Y0G05bJkpUIO0/bI9MhwmD70S5aTWbXGBwxHrelT+XM1k6dM0pk+SwNkpTRN7Pg==",
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/postcss/"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/postcss"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "nanoid": "^3.3.11",
        "picocolors": "^1.1.1",
        "source-map-js": "^1.2.1"
      },
      "engines": {
        "node": "^10 || ^12 || >=14"
      }
    },
    "node_modules/postcss-value-parser": {
      "version": "4.2.0",
      "resolved": "https://registry.npmjs.org/postcss-value-parser/-/postcss-value-parser-4.2.0.tgz",
      "integrity": "sha512-1NNCs6uurfkVbeXG4S8JFT9t19m45ICnif8zWLd5oPSZ50QnwMfK+H3jv408d4jw/7Bttv5axS5IiHoLaVNHeQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/prelude-ls": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/prelude-ls/-/prelude-ls-1.2.1.tgz",
      "integrity": "sha512-vkcDPrRZo1QZLbn5RLGPpg/WmIQ65qoWWhcGKf/b5eplkkarX0m9z8ppCat4mlOqUsWpyNuYgO3VRyrYHSzX5g==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 0.8.0"
      }
    },
    "node_modules/punycode": {
      "version": "2.3.1",
      "resolved": "https://registry.npmjs.org/punycode/-/punycode-2.3.1.tgz",
      "integrity": "sha512-vYt7UD1U9Wg6138shLtLOvdAu+8DsC/ilFtEVHcH+wydcSpNE20AfSOduf6MkRFahL5FY7X1oU7nKVZFtfq8Fg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/queue-microtask": {
      "version": "1.2.3",
      "resolved": "https://registry.npmjs.org/queue-microtask/-/queue-microtask-1.2.3.tgz",
      "integrity": "sha512-NuaNSa6flKT5JaSYQzJok04JzTL1CA6aGhv5rfLW3PgqA+M2ChpZQnAC8h8i4ZFkBS8X5RqkDBHA7r4hej3K9A==",
      "dev": true,
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/feross"
        },
        {
          "type": "patreon",
          "url": "https://www.patreon.com/feross"
        },
        {
          "type": "consulting",
          "url": "https://feross.org/support"
        }
      ],
      "license": "MIT"
    },
    "node_modules/react": {
      "version": "19.1.0",
      "resolved": "https://registry.npmjs.org/react/-/react-19.1.0.tgz",
      "integrity": "sha512-FS+XFBNvn3GTAWq26joslQgWNoFu08F4kl0J4CgdNKADkdSGXQyTCnKteIAJy96Br6YbpEU1LSzV5dYtjMkMDg==",
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/react-dom": {
      "version": "19.1.0",
      "resolved": "https://registry.npmjs.org/react-dom/-/react-dom-19.1.0.tgz",
      "integrity": "sha512-Xs1hdnE+DyKgeHJeJznQmYMIBG3TKIHJJT95Q58nHLSrElKlGQqDTR2HQ9fx5CN/Gk6Vh/kupBTDLU11/nDk/g==",
      "license": "MIT",
      "dependencies": {
        "scheduler": "^0.26.0"
      },
      "peerDependencies": {
        "react": "^19.1.0"
      }
    },
    "node_modules/react-refresh": {
      "version": "0.17.0",
      "resolved": "https://registry.npmjs.org/react-refresh/-/react-refresh-0.17.0.tgz",
      "integrity": "sha512-z6F7K9bV85EfseRCp2bzrpyQ0Gkw1uLoCel9XBVWPg/TjRj94SkJzUTGfOa4bs7iJvBWtQG0Wq7wnI0syw3EBQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/react-router": {
      "version": "6.30.1",
      "resolved": "https://registry.npmjs.org/react-router/-/react-router-6.30.1.tgz",
      "integrity": "sha512-X1m21aEmxGXqENEPG3T6u0Th7g0aS4ZmoNynhbs+Cn+q+QGTLt+d5IQ2bHAXKzKcxGJjxACpVbnYQSCRcfxHlQ==",
      "license": "MIT",
      "dependencies": {
        "@remix-run/router": "1.23.0"
      },
      "engines": {
        "node": ">=14.0.0"
      },
      "peerDependencies": {
        "react": ">=16.8"
      }
    },
    "node_modules/react-router-dom": {
      "version": "6.30.1",
      "resolved": "https://registry.npmjs.org/react-router-dom/-/react-router-dom-6.30.1.tgz",
      "integrity": "sha512-llKsgOkZdbPU1Eg3zK8lCn+sjD9wMRZZPuzmdWWX5SUs8OFkN5HnFVC0u5KMeMaC9aoancFI/KoLuKPqN+hxHw==",
      "license": "MIT",
      "dependencies": {
        "@remix-run/router": "1.23.0",
        "react-router": "6.30.1"
      },
      "engines": {
        "node": ">=14.0.0"
      },
      "peerDependencies": {
        "react": ">=16.8",
        "react-dom": ">=16.8"
      }
    },
    "node_modules/resolve-from": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/resolve-from/-/resolve-from-4.0.0.tgz",
      "integrity": "sha512-pb/MYmXstAkysRFx8piNI1tGFNQIFA3vkE3Gq4EuA1dF6gHp/+vgZqsCGJapvy8N3Q+4o7FwvquPJcnZ7RYy4g==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=4"
      }
    },
    "node_modules/reusify": {
      "version": "1.1.0",
      "resolved": "https://registry.npmjs.org/reusify/-/reusify-1.1.0.tgz",
      "integrity": "sha512-g6QUff04oZpHs0eG5p83rFLhHeV00ug/Yf9nZM6fLeUrPguBTkTQOdpAWWspMh55TZfVQDPaN3NQJfbVRAxdIw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "iojs": ">=1.0.0",
        "node": ">=0.10.0"
      }
    },
    "node_modules/rollup": {
      "version": "4.44.0",
      "resolved": "https://registry.npmjs.org/rollup/-/rollup-4.44.0.tgz",
      "integrity": "sha512-qHcdEzLCiktQIfwBq420pn2dP+30uzqYxv9ETm91wdt2R9AFcWfjNAmje4NWlnCIQ5RMTzVf0ZyisOKqHR6RwA==",
      "license": "MIT",
      "dependencies": {
        "@types/estree": "1.0.8"
      },
      "bin": {
        "rollup": "dist/bin/rollup"
      },
      "engines": {
        "node": ">=18.0.0",
        "npm": ">=8.0.0"
      },
      "optionalDependencies": {
        "@rollup/rollup-android-arm-eabi": "4.44.0",
        "@rollup/rollup-android-arm64": "4.44.0",
        "@rollup/rollup-darwin-arm64": "4.44.0",
        "@rollup/rollup-darwin-x64": "4.44.0",
        "@rollup/rollup-freebsd-arm64": "4.44.0",
        "@rollup/rollup-freebsd-x64": "4.44.0",
        "@rollup/rollup-linux-arm-gnueabihf": "4.44.0",
        "@rollup/rollup-linux-arm-musleabihf": "4.44.0",
        "@rollup/rollup-linux-arm64-gnu": "4.44.0",
        "@rollup/rollup-linux-arm64-musl": "4.44.0",
        "@rollup/rollup-linux-loongarch64-gnu": "4.44.0",
        "@rollup/rollup-linux-powerpc64le-gnu": "4.44.0",
        "@rollup/rollup-linux-riscv64-gnu": "4.44.0",
        "@rollup/rollup-linux-riscv64-musl": "4.44.0",
        "@rollup/rollup-linux-s390x-gnu": "4.44.0",
        "@rollup/rollup-linux-x64-gnu": "4.44.0",
        "@rollup/rollup-linux-x64-musl": "4.44.0",
        "@rollup/rollup-win32-arm64-msvc": "4.44.0",
        "@rollup/rollup-win32-ia32-msvc": "4.44.0",
        "@rollup/rollup-win32-x64-msvc": "4.44.0",
        "fsevents": "~2.3.2"
      }
    },
    "node_modules/run-parallel": {
      "version": "1.2.0",
      "resolved": "https://registry.npmjs.org/run-parallel/-/run-parallel-1.2.0.tgz",
      "integrity": "sha512-5l4VyZR86LZ/lDxZTR6jqL8AFE2S0IFLMP26AbjsLVADxHdhB/c0GUsH+y39UfCi3dzz8OlQuPmnaJOMoDHQBA==",
      "dev": true,
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/feross"
        },
        {
          "type": "patreon",
          "url": "https://www.patreon.com/feross"
        },
        {
          "type": "consulting",
          "url": "https://feross.org/support"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "queue-microtask": "^1.2.2"
      }
    },
    "node_modules/scheduler": {
      "version": "0.26.0",
      "resolved": "https://registry.npmjs.org/scheduler/-/scheduler-0.26.0.tgz",
      "integrity": "sha512-NlHwttCI/l5gCPR3D1nNXtWABUmBwvZpEQiD4IXSbIDq8BzLIK/7Ir5gTFSGZDUu37K5cMNp0hFtzO38sC7gWA==",
      "license": "MIT"
    },
    "node_modules/semver": {
      "version": "6.3.1",
      "resolved": "https://registry.npmjs.org/semver/-/semver-6.3.1.tgz",
      "integrity": "sha512-BR7VvDCVHO+q2xBEWskxS6DJE1qRnb7DxzUrogb71CWoSficBxYsiAGd+Kl0mmq/MprG9yArRkyrQxTO6XjMzA==",
      "dev": true,
      "license": "ISC",
      "bin": {
        "semver": "bin/semver.js"
      }
    },
    "node_modules/shebang-command": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/shebang-command/-/shebang-command-2.0.0.tgz",
      "integrity": "sha512-kHxr2zZpYtdmrN1qDjrrX/Z1rR1kG8Dx+gkpK1G4eXmvXswmcE1hTWBWYUzlraYw1/yZp6YuDY77YtvbN0dmDA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "shebang-regex": "^3.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/shebang-regex": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/shebang-regex/-/shebang-regex-3.0.0.tgz",
      "integrity": "sha512-7++dFhtcx3353uBaq8DDR4NuxBetBzC7ZQOhmTQInHEd6bSrXdiEyzCvG07Z44UYdLShWUyXt5M/yhz8ekcb1A==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/source-map-js": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.1.tgz",
      "integrity": "sha512-UXWMKhLOwVKb728IUtQPXxfYU+usdybtUrK/8uGE8CQMvrhOpwvzDBwj0QhSL7MQc7vIsISBG8VQ8+IDQxpfQA==",
      "license": "BSD-3-Clause",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/strip-json-comments": {
      "version": "3.1.1",
      "resolved": "https://registry.npmjs.org/strip-json-comments/-/strip-json-comments-3.1.1.tgz",
      "integrity": "sha512-6fPc+R4ihwqP6N/aIv2f1gMH8lOVtWQHoqC4yK6oSDVVocumAsfCqjkXnqiYMhmMwS/mEHLp7Vehlt3ql6lEig==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    },
    "node_modules/supports-color": {
      "version": "7.2.0",
      "resolved": "https://registry.npmjs.org/supports-color/-/supports-color-7.2.0.tgz",
      "integrity": "sha512-qpCAvRl9stuOHveKsn7HncJRvv501qIacKzQlO/+Lwxc9+0q2wLyv4Dfvt80/DPn2pqOBsJdDiogXGR9+OvwRw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "has-flag": "^4.0.0"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/tailwind-merge": {
      "version": "3.3.1",
      "resolved": "https://registry.npmjs.org/tailwind-merge/-/tailwind-merge-3.3.1.tgz",
      "integrity": "sha512-gBXpgUm/3rp1lMZZrM/w7D8GKqshif0zAymAhbCyIt8KMe+0v9DQ7cdYLR4FHH/cKpdTXb+A/tKKU3eolfsI+g==",
      "license": "MIT",
      "funding": {
        "type": "github",
        "url": "https://github.com/sponsors/dcastil"
      }
    },
    "node_modules/tailwindcss": {
      "version": "4.1.13",
      "resolved": "https://registry.npmjs.org/tailwindcss/-/tailwindcss-4.1.13.tgz",
      "integrity": "sha512-i+zidfmTqtwquj4hMEwdjshYYgMbOrPzb9a0M3ZgNa0JMoZeFC6bxZvO8yr8ozS6ix2SDz0+mvryPeBs2TFE+w==",
      "license": "MIT"
    },
    "node_modules/tailwindcss-animate": {
      "version": "1.0.7",
      "resolved": "https://registry.npmjs.org/tailwindcss-animate/-/tailwindcss-animate-1.0.7.tgz",
      "integrity": "sha512-bl6mpH3T7I3UFxuvDEXLxy/VuFxBk5bbzplh7tXI68mwMokNYd1t9qPBHlnyTwfa4JGC4zP516I1hYYtQ/vspA==",
      "license": "MIT",
      "peerDependencies": {
        "tailwindcss": ">=3.0.0 || insiders"
      }
    },
    "node_modules/tapable": {
      "version": "2.2.3",
      "resolved": "https://registry.npmjs.org/tapable/-/tapable-2.2.3.tgz",
      "integrity": "sha512-ZL6DDuAlRlLGghwcfmSn9sK3Hr6ArtyudlSAiCqQ6IfE+b+HHbydbYDIG15IfS5do+7XQQBdBiubF/cV2dnDzg==",
      "license": "MIT",
      "engines": {
        "node": ">=6"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/webpack"
      }
    },
    "node_modules/tar": {
      "version": "7.4.3",
      "resolved": "https://registry.npmjs.org/tar/-/tar-7.4.3.tgz",
      "integrity": "sha512-5S7Va8hKfV7W5U6g3aYxXmlPoZVAwUMy9AOKyF2fVuZa2UD3qZjg578OrLRt8PcNN1PleVaL/5/yYATNL0ICUw==",
      "license": "ISC",
      "dependencies": {
        "@isaacs/fs-minipass": "^4.0.0",
        "chownr": "^3.0.0",
        "minipass": "^7.1.2",
        "minizlib": "^3.0.1",
        "mkdirp": "^3.0.1",
        "yallist": "^5.0.0"
      },
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/tar/node_modules/yallist": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/yallist/-/yallist-5.0.0.tgz",
      "integrity": "sha512-YgvUTfwqyc7UXVMrB+SImsVYSmTS8X/tSrtdNZMImM+n7+QTriRXyXim0mBrTXNeqzVF0KWGgHPeiyViFFrNDw==",
      "license": "BlueOak-1.0.0",
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/tinyglobby": {
      "version": "0.2.14",
      "resolved": "https://registry.npmjs.org/tinyglobby/-/tinyglobby-0.2.14.tgz",
      "integrity": "sha512-tX5e7OM1HnYr2+a2C/4V0htOcSQcoSTH9KgJnVvNm5zm/cyEWKJ7j7YutsH9CxMdtOkkLFy2AHrMci9IM8IPZQ==",
      "license": "MIT",
      "dependencies": {
        "fdir": "^6.4.4",
        "picomatch": "^4.0.2"
      },
      "engines": {
        "node": ">=12.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/SuperchupuDev"
      }
    },
    "node_modules/tinyglobby/node_modules/fdir": {
      "version": "6.4.6",
      "resolved": "https://registry.npmjs.org/fdir/-/fdir-6.4.6.tgz",
      "integrity": "sha512-hiFoqpyZcfNm1yc4u8oWCf9A2c4D3QjCrks3zmoVKVxpQRzmPNar1hUJcBG2RQHvEVGDN+Jm81ZheVLAQMK6+w==",
      "license": "MIT",
      "peerDependencies": {
        "picomatch": "^3 || ^4"
      },
      "peerDependenciesMeta": {
        "picomatch": {
          "optional": true
        }
      }
    },
    "node_modules/tinyglobby/node_modules/picomatch": {
      "version": "4.0.2",
      "resolved": "https://registry.npmjs.org/picomatch/-/picomatch-4.0.2.tgz",
      "integrity": "sha512-M7BAV6Rlcy5u+m6oPhAPFgJTzAioX/6B0DxyvDlo9l8+T3nLKbrczg2WLUyzd45L8RqfUMyGPzekbMvX2Ldkwg==",
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/jonschlinkert"
      }
    },
    "node_modules/to-regex-range": {
      "version": "5.0.1",
      "resolved": "https://registry.npmjs.org/to-regex-range/-/to-regex-range-5.0.1.tgz",
      "integrity": "sha512-65P7iz6X5yEr1cwcgvQxbbIw7Uk3gOy5dIdtZ4rDveLqhrdJP+Li/Hx6tyK0NEb+2GCyneCMJiGqrADCSNk8sQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "is-number": "^7.0.0"
      },
      "engines": {
        "node": ">=8.0"
      }
    },
    "node_modules/ts-api-utils": {
      "version": "2.1.0",
      "resolved": "https://registry.npmjs.org/ts-api-utils/-/ts-api-utils-2.1.0.tgz",
      "integrity": "sha512-CUgTZL1irw8u29bzrOD/nH85jqyc74D6SshFgujOIA7osm2Rz7dYH77agkx7H4FBNxDq7Cjf+IjaX/8zwFW+ZQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=18.12"
      },
      "peerDependencies": {
        "typescript": ">=4.8.4"
      }
    },
    "node_modules/tslib": {
      "version": "2.8.1",
      "resolved": "https://registry.npmjs.org/tslib/-/tslib-2.8.1.tgz",
      "integrity": "sha512-oJFu94HQb+KVduSUQL7wnpmqnfmLsOA/nAh6b6EH0wCEoK0/mPeXU6c3wKDV83MkOuHPRHtSXKKU99IBazS/2w==",
      "license": "0BSD"
    },
    "node_modules/type-check": {
      "version": "0.4.0",
      "resolved": "https://registry.npmjs.org/type-check/-/type-check-0.4.0.tgz",
      "integrity": "sha512-XleUoc9uwGXqjWwXaUTZAmzMcFZ5858QA2vvx1Ur5xIcixXIP+8LnFDgRplU30us6teqdlskFfu+ae4K79Ooew==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "prelude-ls": "^1.2.1"
      },
      "engines": {
        "node": ">= 0.8.0"
      }
    },
    "node_modules/typescript": {
      "version": "5.8.3",
      "resolved": "https://registry.npmjs.org/typescript/-/typescript-5.8.3.tgz",
      "integrity": "sha512-p1diW6TqL9L07nNxvRMM7hMMw4c5XOo/1ibL4aAIGmSAt9slTE1Xgw5KWuof2uTOvCg9BY7ZRi+GaF+7sfgPeQ==",
      "dev": true,
      "license": "Apache-2.0",
      "bin": {
        "tsc": "bin/tsc",
        "tsserver": "bin/tsserver"
      },
      "engines": {
        "node": ">=14.17"
      }
    },
    "node_modules/typescript-eslint": {
      "version": "8.35.0",
      "resolved": "https://registry.npmjs.org/typescript-eslint/-/typescript-eslint-8.35.0.tgz",
      "integrity": "sha512-uEnz70b7kBz6eg/j0Czy6K5NivaYopgxRjsnAJ2Fx5oTLo3wefTHIbL7AkQr1+7tJCRVpTs/wiM8JR/11Loq9A==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@typescript-eslint/eslint-plugin": "8.35.0",
        "@typescript-eslint/parser": "8.35.0",
        "@typescript-eslint/utils": "8.35.0"
      },
      "engines": {
        "node": "^18.18.0 || ^20.9.0 || >=21.1.0"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/typescript-eslint"
      },
      "peerDependencies": {
        "eslint": "^8.57.0 || ^9.0.0",
        "typescript": ">=4.8.4 <5.9.0"
      }
    },
    "node_modules/undici-types": {
      "version": "7.10.0",
      "resolved": "https://registry.npmjs.org/undici-types/-/undici-types-7.10.0.tgz",
      "integrity": "sha512-t5Fy/nfn+14LuOc2KNYg75vZqClpAiqscVvMygNnlsHBFpSXdJaYtXMcdNLpl/Qvc3P2cB3s6lOV51nqsFq4ag==",
      "devOptional": true,
      "license": "MIT"
    },
    "node_modules/update-browserslist-db": {
      "version": "1.1.3",
      "resolved": "https://registry.npmjs.org/update-browserslist-db/-/update-browserslist-db-1.1.3.tgz",
      "integrity": "sha512-UxhIZQ+QInVdunkDAaiazvvT/+fXL5Osr0JZlJulepYu6Jd7qJtDZjlur0emRlT71EN3ScPoE7gvsuIKKNavKw==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/browserslist"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/browserslist"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "escalade": "^3.2.0",
        "picocolors": "^1.1.1"
      },
      "bin": {
        "update-browserslist-db": "cli.js"
      },
      "peerDependencies": {
        "browserslist": ">= 4.21.0"
      }
    },
    "node_modules/uri-js": {
      "version": "4.4.1",
      "resolved": "https://registry.npmjs.org/uri-js/-/uri-js-4.4.1.tgz",
      "integrity": "sha512-7rKUyy33Q1yc98pQ1DAmLtwX109F7TIfWlW1Ydo8Wl1ii1SeHieeh0HHfPeL2fMXK6z0s8ecKs9frCuLJvndBg==",
      "dev": true,
      "license": "BSD-2-Clause",
      "dependencies": {
        "punycode": "^2.1.0"
      }
    },
    "node_modules/vite": {
      "version": "6.3.5",
      "resolved": "https://registry.npmjs.org/vite/-/vite-6.3.5.tgz",
      "integrity": "sha512-cZn6NDFE7wdTpINgs++ZJ4N49W2vRp8LCKrn3Ob1kYNtOo21vfDoaV5GzBfLU4MovSAB8uNRm4jgzVQZ+mBzPQ==",
      "license": "MIT",
      "dependencies": {
        "esbuild": "^0.25.0",
        "fdir": "^6.4.4",
        "picomatch": "^4.0.2",
        "postcss": "^8.5.3",
        "rollup": "^4.34.9",
        "tinyglobby": "^0.2.13"
      },
      "bin": {
        "vite": "bin/vite.js"
      },
      "engines": {
        "node": "^18.0.0 || ^20.0.0 || >=22.0.0"
      },
      "funding": {
        "url": "https://github.com/vitejs/vite?sponsor=1"
      },
      "optionalDependencies": {
        "fsevents": "~2.3.3"
      },
      "peerDependencies": {
        "@types/node": "^18.0.0 || ^20.0.0 || >=22.0.0",
        "jiti": ">=1.21.0",
        "less": "*",
        "lightningcss": "^1.21.0",
        "sass": "*",
        "sass-embedded": "*",
        "stylus": "*",
        "sugarss": "*",
        "terser": "^5.16.0",
        "tsx": "^4.8.1",
        "yaml": "^2.4.2"
      },
      "peerDependenciesMeta": {
        "@types/node": {
          "optional": true
        },
        "jiti": {
          "optional": true
        },
        "less": {
          "optional": true
        },
        "lightningcss": {
          "optional": true
        },
        "sass": {
          "optional": true
        },
        "sass-embedded": {
          "optional": true
        },
        "stylus": {
          "optional": true
        },
        "sugarss": {
          "optional": true
        },
        "terser": {
          "optional": true
        },
        "tsx": {
          "optional": true
        },
        "yaml": {
          "optional": true
        }
      }
    },
    "node_modules/vite/node_modules/fdir": {
      "version": "6.4.6",
      "resolved": "https://registry.npmjs.org/fdir/-/fdir-6.4.6.tgz",
      "integrity": "sha512-hiFoqpyZcfNm1yc4u8oWCf9A2c4D3QjCrks3zmoVKVxpQRzmPNar1hUJcBG2RQHvEVGDN+Jm81ZheVLAQMK6+w==",
      "license": "MIT",
      "peerDependencies": {
        "picomatch": "^3 || ^4"
      },
      "peerDependenciesMeta": {
        "picomatch": {
          "optional": true
        }
      }
    },
    "node_modules/vite/node_modules/picomatch": {
      "version": "4.0.2",
      "resolved": "https://registry.npmjs.org/picomatch/-/picomatch-4.0.2.tgz",
      "integrity": "sha512-M7BAV6Rlcy5u+m6oPhAPFgJTzAioX/6B0DxyvDlo9l8+T3nLKbrczg2WLUyzd45L8RqfUMyGPzekbMvX2Ldkwg==",
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/jonschlinkert"
      }
    },
    "node_modules/which": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/which/-/which-2.0.2.tgz",
      "integrity": "sha512-BLI3Tl1TW3Pvl70l3yq3Y64i+awpwXqsGBYWkkqMtnbXgrMD+yj7rhW0kuEDxzJaYXGjEW5ogapKNMEKNMjibA==",
      "dev": true,
      "license": "ISC",
      "dependencies": {
        "isexe": "^2.0.0"
      },
      "bin": {
        "node-which": "bin/node-which"
      },
      "engines": {
        "node": ">= 8"
      }
    },
    "node_modules/word-wrap": {
      "version": "1.2.5",
      "resolved": "https://registry.npmjs.org/word-wrap/-/word-wrap-1.2.5.tgz",
      "integrity": "sha512-BN22B5eaMMI9UMtjrGd5g5eCYPpCPDUy0FJXbYsaT5zYxjFOckS53SQDE3pWkVoWpHXVb3BrYcEN4Twa55B5cA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/yallist": {
      "version": "3.1.1",
      "resolved": "https://registry.npmjs.org/yallist/-/yallist-3.1.1.tgz",
      "integrity": "sha512-a4UGQaWPH59mOXUYnAG2ewncQS4i4F43Tv3JoAM+s2VDAmS9NsK8GpDMLrCHPksFT7h3K6TOoUNn2pb7RoXx4g==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/yocto-queue": {
      "version": "0.1.0",
      "resolved": "https://registry.npmjs.org/yocto-queue/-/yocto-queue-0.1.0.tgz",
      "integrity": "sha512-rVksvsnNCdJ/ohGc6xgPwyN8eheCxsiLM8mxuE/t/mOVqJewPuO1miLpTHQiRgTKCLexL4MeAFVagts7HmNZ2Q==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=10"
      },
      "funding": {
        "url": "https://github.com/sponsors/sindresorhus"
      }
    }
  }
}
```

## CyberX-frontend/package.json

```json
{
  "name": "cyberx-frontend",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "@tailwindcss/vite": "^4.1.13",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.542.0",
    "motion": "^12.23.12",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router-dom": "^6.28.0",
    "tailwind-merge": "^3.3.1",
    "tailwindcss-animate": "^1.0.7"
  },
  "devDependencies": {
    "@eslint/js": "^9.25.0",
    "@types/node": "^24.3.1",
    "@types/react": "^19.1.2",
    "@types/react-dom": "^19.1.2",
    "@vitejs/plugin-react": "^4.4.1",
    "autoprefixer": "^10.4.21",
    "eslint": "^9.25.0",
    "eslint-plugin-react-hooks": "^5.2.0",
    "eslint-plugin-react-refresh": "^0.4.19",
    "globals": "^16.0.0",
    "postcss": "^8.5.6",
    "tailwindcss": "^4.1.13",
    "typescript": "~5.8.3",
    "typescript-eslint": "^8.30.1",
    "vite": "^6.3.5"
  }
}
```

## CyberX-frontend/README.md

```md
# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  plugins: {
    // Add the react-x and react-dom plugins
    'react-x': reactX,
    'react-dom': reactDom,
  },
  rules: {
    // other rules...
    // Enable its recommended typescript rules
    ...reactX.configs['recommended-typescript'].rules,
    ...reactDom.configs.recommended.rules,
  },
})
```
```

## CyberX-frontend/tailwind.config.js

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

## CyberX-frontend/tsconfig.app.json

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    /* Path mapping for imports */
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"],
  "composite": true
}
```

## CyberX-frontend/tsconfig.json

```json
{
  "files": [],
  "references": [
    {
      "path": "./tsconfig.app.json"
    },
    {
      "path": "./tsconfig.node.json"
    }
  ]
}
```

## CyberX-frontend/tsconfig.node.json

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["vite.config.ts"],
  "composite": true
}
```

## CyberX-frontend/vite.config.ts

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import tailwind from '@tailwindcss/vite'
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
```

## .gitignore

```
# Python
__pycache__/
*.pyc
venv/
.env

# Node
node_modules/
dist/
.vscode/

# Logs
*.log
data/logs/
```

## export.md

File is too large to process (1432411 bytes)

