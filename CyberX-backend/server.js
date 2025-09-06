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
